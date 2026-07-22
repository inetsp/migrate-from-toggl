/**
 * REC aggregation business rules — reference implementation.
 *
 * This module is the canonical implementation of REC's time aggregation,
 * rounding, and exclusion logic. Every rule traces back to the wiki:
 *
 *   - Rounding (interval, method, scope, minimum billable):
 *     rec.wiki/time-reporting-business-rules.md → "Rounding Rules"
 *
 *   - Day -> Task -> Description grouping (auto-merge identical descriptions):
 *     rec.wiki/time-reporting-business-rules.md → "Aggregation Rules"
 *
 *   - Deferred / excluded tasks (held billing, missing PO, etc.):
 *     rec.wiki/time-reporting-business-rules.md → "Deferred & Held Entries"
 *
 * Defaults (15-min ceil, sum-then-round at task-per-day, 15-min minimum
 * billable) match the "Standard European Consulting" configuration
 * template — REC's most common preset.
 */

import { sanitizeDisplayText } from "./sanitize.mjs";

export const ROUNDING_METHODS = ["ceil", "round", "floor"];

export const DEFAULT_ROUNDING = {
  interval: 15,
  method: "ceil",
  minimumBillable: 15,
};

/**
 * Round a duration in minutes to the configured interval.
 * `interval = 0` disables rounding (returns the input unchanged).
 */
export function applyRounding(
  minutes,
  { interval = 15, method = "ceil" } = {}
) {
  if (interval === 0) return minutes;
  switch (method) {
    case "ceil":
      return Math.ceil(minutes / interval) * interval;
    case "floor":
      return Math.floor(minutes / interval) * interval;
    case "round":
      return Math.round(minutes / interval) * interval;
    default:
      throw new Error(
        `Unknown rounding method: ${method}. Must be one of: ${ROUNDING_METHODS.join(", ")}`
      );
  }
}

/**
 * Apply the minimum-billable floor: any task that has work at all in a
 * given day is billed for at least the configured minimum (e.g. 15 min).
 * `minimum = 0` disables the floor.
 */
export function applyMinimumBillable(minutes, minimum = 0) {
  if (minutes > 0 && minutes < minimum) return minimum;
  return minutes;
}

/**
 * Build a case-insensitive substring matcher for excluded task names.
 * Used to defer billing for tasks that are blocked (missing PO, etc.).
 */
export function makeTaskExcluder(patterns = []) {
  // An empty pattern would match every task name ("x".includes("") is
  // always true in JS) and silently exclude everything, so blank/
  // whitespace-only patterns are dropped rather than treated as a match-all.
  const lowered = patterns.map((p) => p.toLowerCase().trim()).filter(Boolean);
  return (taskName) => {
    if (!taskName) return false;
    if (lowered.length === 0) return false;
    const lower = taskName.toLowerCase();
    return lowered.some((p) => lower.includes(p));
  };
}

/**
 * Aggregate raw Toggl-style time entries by day -> task -> description.
 * Identical descriptions on the same task in the same day are merged.
 *
 * @param entries Iterable of objects with `start`, `duration` (seconds),
 *                `project_id`, `task_id`, `description`.
 * @param opts.projects        Map<projectId, projectObj>  (optional, for resolution)
 * @param opts.tasks           Map<taskId, taskObj>        (optional, for resolution)
 * @param opts.clients         Map<clientId, clientObj>    (optional, for resolution)
 * @param opts.isTaskExcluded  (taskName) => boolean       (default: never excluded)
 *
 * @returns { days, excluded }
 *   days     Map<date, Map<taskKey, Map<description, totalMinutes>>>
 *            where taskKey is "client|||project|||task"
 *   excluded Map<taskName, totalMinutes>
 */
export function aggregateByDayTaskDesc(entries, opts = {}) {
  const {
    projects = new Map(),
    tasks = new Map(),
    clients = new Map(),
    isTaskExcluded = () => false,
  } = opts;

  const days = new Map();
  const excluded = new Map();

  for (const entry of entries) {
    const date = entry.start.split("T")[0];
    const durationMin = Math.round(entry.duration / 60);
    const project = projects.get(entry.project_id);
    const task = tasks.get(entry.task_id);
    const client = project ? clients.get(project.client_id) : null;

    const clientName = sanitizeDisplayText(client?.name) || "(no client)";
    const projectName = sanitizeDisplayText(project?.name) || "(no project)";
    const taskName = sanitizeDisplayText(task?.name) || "(no task)";
    const description = sanitizeDisplayText(entry.description) || "(no description)";

    if (isTaskExcluded(taskName)) {
      excluded.set(taskName, (excluded.get(taskName) || 0) + durationMin);
      continue;
    }

    const taskKey = `${clientName}|||${projectName}|||${taskName}`;
    if (!days.has(date)) days.set(date, new Map());
    const dayMap = days.get(date);
    if (!dayMap.has(taskKey)) dayMap.set(taskKey, new Map());
    const taskDescMap = dayMap.get(taskKey);
    taskDescMap.set(description, (taskDescMap.get(description) || 0) + durationMin);
  }

  return { days, excluded };
}

/**
 * Convenience: apply the full task-per-day rounding pipeline (sum
 * descriptions for a task on a day, then round, then apply minimum
 * billable). Returns { raw, rounded } in minutes.
 */
export function roundTaskDay(rawMinutes, rounding = DEFAULT_ROUNDING) {
  const rounded = applyMinimumBillable(
    applyRounding(rawMinutes, rounding),
    rounding.minimumBillable ?? 0
  );
  return { raw: rawMinutes, rounded };
}

/**
 * Parse a taskKey produced by `aggregateByDayTaskDesc` into its three
 * parts. Returns { client, project, task }.
 */
export function parseTaskKey(taskKey) {
  const [client, project, task] = taskKey.split("|||");
  return { client, project, task };
}

/**
 * Return the ISO-week Monday for a given YYYY-MM-DD date, as YYYY-MM-DD.
 * Used to group days into weeks where the week starts on Monday and
 * ends on Sunday (so Sat and Sun belong to the same week as the
 * preceding Mon-Fri, not the following one).
 */
export function isoWeekKey(date) {
  const d = new Date(date + "T12:00:00");
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return weekStart.toISOString().split("T")[0];
}

/**
 * Return the Sunday (ISO week end) for a given ISO week start.
 */
export function isoWeekEnd(weekStartKey) {
  return new Date(
    new Date(weekStartKey + "T12:00:00").getTime() + 6 * 86400000
  )
    .toISOString()
    .split("T")[0];
}

/**
 * From the `days` map returned by aggregateByDayTaskDesc, return a Set of
 * task names that appear under more than one (client, project)
 * combination. Used by display layers to know when to disambiguate task
 * rows with a project label.
 *
 * Example: if "Development" appears under both
 * "Contoso Nordics Website Platform" and "Contoso Nordics Data Migration Backend"
 * projects, this returns Set { "Development" }.
 */
export function detectAmbiguousTaskNames(days) {
  const taskToScopes = new Map(); // taskName -> Set<"client|||project">
  for (const dayMap of days.values()) {
    for (const taskKey of dayMap.keys()) {
      const { client, project, task } = parseTaskKey(taskKey);
      if (!taskToScopes.has(task)) taskToScopes.set(task, new Set());
      taskToScopes.get(task).add(`${client}|||${project}`);
    }
  }
  const ambiguous = new Set();
  for (const [task, scopes] of taskToScopes) {
    if (scopes.size > 1) ambiguous.add(task);
  }
  return ambiguous;
}