/**
 * Minimal Toggl API client.
 *
 * Time entries are fetched via the Reports API v3
 * (POST /reports/api/v3/workspace/{id}/search/time_entries), NOT
 * /me/time_entries. The /me endpoint is the Timer-page view and is capped to
 * roughly the last 3 months (it returns 400 "start_date must not be earlier
 * than …" for anything older), so it can't drive a full-history export no
 * matter how the date range is chunked. The Reports API is built for exactly
 * this: full history, up to 1-year windows, row-based pagination via the
 * X-Next-Row-Number response header.
 *
 * Authentication is via API token (HTTP Basic, with the literal string
 * "api_token" as the password — Toggl's convention). Find your token at
 * https://track.toggl.com/profile.
 */
import { chunkDateRange } from "./date-range.mjs";

const HOST = "https://api.track.toggl.com";
const REPORTS_MAX_SPAN_DAYS = 365; // Reports API allows up to a 1-year window.

export class TogglApiError extends Error {
  constructor(status, statusText, url, body = "") {
    const detail = body ? ` — ${String(body).slice(0, 300)}` : "";
    super(`Toggl API error: ${status} ${statusText} — ${url}${detail}`);
    this.status = status;
  }
}

export class TogglClient {
  constructor({ token, host = HOST } = {}) {
    if (!token) throw new Error("Toggl API token is required");
    this.host = host;
    this.base = host + "/api/v9";
    this.auth = "Basic " + Buffer.from(token + ":api_token").toString("base64");
  }

  async get(path) {
    const url = this.base + path;
    const res = await fetch(url, { headers: { Authorization: this.auth } });
    if (!res.ok) throw new TogglApiError(res.status, res.statusText, url, await res.text().catch(() => ""));
    return res.json();
  }

  // Reports API POST — returns the parsed body and the response headers
  // (the pagination cursor lives in X-Next-Row-Number).
  async postReports(path, body) {
    const url = this.host + path;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: this.auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new TogglApiError(res.status, res.statusText, url, await res.text().catch(() => ""));
    return { data: await res.json(), headers: res.headers };
  }

  async getMe() {
    return this.get("/me");
  }

  async getDefaultWorkspaceId() {
    const me = await this.getMe();
    return me.default_workspace_id;
  }

  /**
   * Fetch ALL time entries in [startDate, endDate] for a workspace via the
   * Reports API. Chunks into <=1-year windows, paginates each window, and
   * flattens the grouped rows into flat entries with the shape the rest of
   * the tool expects: { start, stop, duration (seconds), project_id, task_id,
   * description, billable, tags }. Zero-length / still-running entries skipped.
   */
  async getTimeEntries(workspaceId, { startDate, endDate }) {
    const out = [];
    for (const chunk of chunkDateRange(startDate, endDate, REPORTS_MAX_SPAN_DAYS)) {
      let firstRowNumber; // pagination cursor
      for (let guard = 0; guard < 100000; guard++) {
        const body = { start_date: chunk.start, end_date: chunk.end, page_size: 200 };
        if (firstRowNumber) body.first_row_number = firstRowNumber;
        const { data, headers } = await this.postReports(
          `/reports/api/v3/workspace/${workspaceId}/search/time_entries`,
          body
        );
        for (const row of data ?? []) {
          // Each v3 row carries the metadata plus a nested time_entries array;
          // fall back to treating the row itself as one entry.
          const items = Array.isArray(row.time_entries) && row.time_entries.length ? row.time_entries : [row];
          for (const te of items) {
            const start = te.start ?? row.start;
            const stop = te.stop ?? te.end ?? row.stop ?? null;
            let seconds = te.seconds ?? row.seconds;
            if (seconds == null && start && stop) {
              seconds = Math.max(0, Math.round((new Date(stop) - new Date(start)) / 1000));
            }
            if (!(seconds > 0)) continue;
            out.push({
              start,
              stop,
              duration: seconds,
              project_id: row.project_id ?? null,
              task_id: row.task_id ?? null,
              description: row.description ?? "",
              billable: row.billable ?? false,
              tags: [],
            });
          }
        }
        const next = headers.get("x-next-row-number");
        if (!next) break;
        firstRowNumber = Number(next);
      }
    }
    return out;
  }

  // Workspace metadata (not time-limited). active=both so ARCHIVED projects are
  // included — historical entries very often point at archived projects.
  async getProjects(workspaceId) {
    const projects = await this.get(`/workspaces/${workspaceId}/projects?per_page=500&active=both`);
    return new Map((projects || []).map((p) => [p.id, p]));
  }

  /**
   * Fetch tasks across the given projects. Some projects have no tasks; the API
   * returns a 404 for those, which is expected and silently skipped. Any other
   * failure is warned about but not fatal — the export continues (a missing
   * task name is better than aborting a full history pull).
   */
  async getTasks(workspaceId, projectIds) {
    const map = new Map();
    for (const pid of projectIds) {
      try {
        const tasks = await this.get(`/workspaces/${workspaceId}/projects/${pid}/tasks`);
        if (tasks) for (const t of tasks) map.set(t.id, t);
      } catch (err) {
        if (err instanceof TogglApiError && err.status === 404) continue;
        console.error(`Warning: failed to fetch tasks for project ${pid}: ${err.message}`);
      }
    }
    return map;
  }

  async getClients(workspaceId) {
    const clients = await this.get(`/workspaces/${workspaceId}/clients`);
    return new Map((clients || []).map((c) => [c.id, c]));
  }
}
