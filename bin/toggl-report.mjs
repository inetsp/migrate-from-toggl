#!/usr/bin/env node

/**
 * Toggl -> REC daily report.
 *
 * Pulls time entries from Toggl, aggregates by day -> task -> description,
 * applies REC's standard rounding (15-min ceil, sum-then-round at task-per-day,
 * 15-min minimum billable), and emits a copy-paste ready report.
 *
 * Usage:
 *   TOGGL_API_TOKEN=xxx node bin/toggl-report.mjs
 *   TOGGL_API_TOKEN=xxx node bin/toggl-report.mjs --start 2026-04-01 --end 2026-04-30
 *   ... --workday              compact output for client-system entry (e.g. Workday)
 *   ... --csv                  semicolon-separated CSV (European-friendly)
 *   ... --raw                  raw entries as JSON (no aggregation)
 *   ... --rec-export           versioned JSON for REC's future "Import from
 *                              Toggl" feature (entry-level, not aggregated —
 *                              save this file to import into REC later)
 *   ... --format hmm|dot|comma duration format (default hmm)
 *   ... --exclude-task "Data Migration"  defer tasks matching the substring (repeatable)
 */

import { parseArgs } from "node:util";
import { TogglClient } from "../lib/toggl-api.mjs";
import {
  aggregateByDayTaskDesc,
  applyRounding,
  applyMinimumBillable,
  makeTaskExcluder,
  detectAmbiguousTaskNames,
  isoWeekKey,
  DEFAULT_ROUNDING,
} from "../lib/aggregate.mjs";
import { makeFormatters, FORMATS } from "../lib/format.mjs";
import { buildRecImport } from "../lib/rec-export.mjs";
import { csvField } from "../lib/csv.mjs";
import { isValidDateString } from "../lib/date-range.mjs";

const ROUNDING = DEFAULT_ROUNDING;

const USAGE = `Toggl -> REC daily report.

Usage:
  TOGGL_API_TOKEN=xxx node bin/toggl-report.mjs
  TOGGL_API_TOKEN=xxx node bin/toggl-report.mjs --start 2026-04-01 --end 2026-04-30

Flags:
  --start YYYY-MM-DD        Period start (default: first of current month)
  --end YYYY-MM-DD          Period end (default: today)
  --format hmm|dot|comma    Output duration format (default: hmm)
  --exclude-task <pattern>  Defer tasks matching the substring; repeatable
  --workday                 Compact per-day output
  --csv                     Semicolon-separated CSV (European-friendly)
  --raw                     Raw entries as JSON (no aggregation)
  --rec-export              Versioned JSON for future import into REC
  --token <token>           Inline token override (instead of TOGGL_API_TOKEN)
  --help, -h                Show this help
`;

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      start: { type: "string", default: "" },
      end: { type: "string", default: "" },
      token: { type: "string", default: "" },
      csv: { type: "boolean", default: false },
      raw: { type: "boolean", default: false },
      "rec-export": { type: "boolean", default: false },
      workday: { type: "boolean", default: false },
      format: { type: "string", default: "hmm" },
      "exclude-task": { type: "string", multiple: true, default: [] },
      help: { type: "boolean", default: false, short: "h" },
    },
  }));
} catch (err) {
  console.error(`Error: ${err.message}`);
  console.error();
  console.error(USAGE);
  process.exit(1);
}

if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

if (!FORMATS.includes(args.format)) {
  console.error(
    `Error: --format must be one of: ${FORMATS.join(", ")} (got: ${args.format})`
  );
  process.exit(1);
}

const token = args.token || process.env.TOGGL_API_TOKEN;
if (!token) {
  console.error("Error: Set TOGGL_API_TOKEN env var or pass --token=<your-token>");
  console.error("Find your token at: https://track.toggl.com/profile");
  process.exit(1);
}

const now = new Date();
const startDate =
  args.start ||
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
const endDate = args.end || now.toISOString().split("T")[0];

if (!isValidDateString(startDate)) {
  console.error(`Error: --start must be a real date in YYYY-MM-DD format (got: ${startDate})`);
  process.exit(1);
}
if (!isValidDateString(endDate)) {
  console.error(`Error: --end must be a real date in YYYY-MM-DD format (got: ${endDate})`);
  process.exit(1);
}
if (startDate > endDate) {
  console.error(`Error: --start (${startDate}) must not be after --end (${endDate})`);
  process.exit(1);
}

const { format: formatDuration, formatRaw } = makeFormatters(args.format);
const isTaskExcluded = makeTaskExcluder(args["exclude-task"] || []);
const excludePatterns = (args["exclude-task"] || []).map((p) => p.toLowerCase());

function roundTask(rawMinutes) {
  return applyMinimumBillable(
    applyRounding(rawMinutes, ROUNDING),
    ROUNDING.minimumBillable
  );
}

// --- Output generators ---

function generateReport(days) {
  const sortedDates = [...days.keys()].sort();
  const lines = [];
  let grandTotalRaw = 0;
  let grandTotalRounded = 0;

  for (const date of sortedDates) {
    const dayOfWeek = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "long",
    });
    let dayTotalRaw = 0;
    let dayTotalRounded = 0;

    lines.push("");
    lines.push(`${date} ${dayOfWeek}`);
    lines.push("─".repeat(55));

    const sortedTasks = [...days.get(date).entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    for (const [taskKey, descMap] of sortedTasks) {
      const [clientName, projectName, taskName] = taskKey.split("|||");
      let taskRawMinutes = 0;
      const descEntries = [];
      for (const [desc, mins] of descMap) {
        taskRawMinutes += mins;
        descEntries.push({ desc, mins });
      }
      const taskRoundedMinutes = roundTask(taskRawMinutes);
      dayTotalRaw += taskRawMinutes;
      dayTotalRounded += taskRoundedMinutes;

      const roundedStr = formatDuration(taskRoundedMinutes);
      const rawStr = formatRaw(taskRawMinutes);
      const roundNote =
        taskRawMinutes !== taskRoundedMinutes ? ` (raw: ${rawStr})` : "";

      lines.push(`  ${taskName.padEnd(40)} ${roundedStr}${roundNote}`);
      lines.push(`  [${clientName} · ${projectName}]`);
      for (const { desc, mins } of descEntries.sort((a, b) =>
        a.desc.localeCompare(b.desc)
      )) {
        lines.push(`    ${desc.padEnd(38)} ${formatDuration(mins)}`);
      }
      lines.push("");
    }

    const dayNote =
      dayTotalRaw !== dayTotalRounded ? ` (raw: ${formatRaw(dayTotalRaw)})` : "";
    lines.push(
      `  DAY TOTAL${" ".repeat(29)} ${formatDuration(dayTotalRounded)}${dayNote}`
    );
    lines.push("═".repeat(55));

    grandTotalRaw += dayTotalRaw;
    grandTotalRounded += dayTotalRounded;
  }

  lines.push("");
  lines.push(
    `PERIOD TOTAL: ${formatDuration(grandTotalRounded)} (raw: ${formatRaw(grandTotalRaw)})`
  );
  lines.push(`Period: ${startDate} to ${endDate}`);
  lines.push(
    `Rounding: ${ROUNDING.interval}min ${ROUNDING.method}, scope: task/day, min billable: ${ROUNDING.minimumBillable}min`
  );
  return lines.join("\n");
}

function generateCsv(days) {
  const rows = [
    [
      "Date",
      "Day",
      "Client",
      "Project",
      "Task",
      "Description",
      "Raw (min)",
      "Raw (h:mm)",
      "Rounded (min)",
      "Rounded (h:mm)",
    ].join(";"),
  ];

  const sortedDates = [...days.keys()].sort();

  for (const date of sortedDates) {
    const dayOfWeek = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "short",
    });
    for (const [taskKey, descMap] of [...days.get(date).entries()].sort()) {
      const [clientName, projectName, taskName] = taskKey.split("|||");
      let taskRawMinutes = 0;
      const descriptions = [];
      for (const [desc, mins] of descMap) {
        taskRawMinutes += mins;
        descriptions.push(desc);
      }
      const taskRoundedMinutes = roundTask(taskRawMinutes);

      const descJoined = descriptions.sort().join(" | ");
      rows.push(
        [
          date,
          dayOfWeek,
          csvField(clientName),
          csvField(projectName),
          csvField(taskName),
          csvField(descJoined),
          taskRawMinutes,
          formatDuration(taskRawMinutes),
          taskRoundedMinutes,
          formatDuration(taskRoundedMinutes),
        ].join(";")
      );
    }
  }
  return rows.join("\n");
}

function generateWorkday(days) {
  const sortedDates = [...days.keys()].sort();
  const lines = [];
  let grandTotalRaw = 0;
  let grandTotalRounded = 0;
  let weekRaw = 0;
  let weekRounded = 0;
  let weekNum = 0;
  let weekDays = [];

  // Disambiguate task names that appear under multiple projects within
  // this report. For those, the task line shows " — Project" so the user
  // can tell which Workday project each row belongs to.
  const ambiguousTaskNames = detectAmbiguousTaskNames(days);

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const d = new Date(date + "T12:00:00");
    const dayOfWeek = d.toLocaleDateString("en-US", { weekday: "long" });
    let dayTotalRaw = 0;
    let dayTotalRounded = 0;

    lines.push("");
    lines.push(`${date} ${dayOfWeek}`);
    lines.push("─".repeat(50));

    const sortedTasks = [...days.get(date).entries()].sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    for (const [taskKey, descMap] of sortedTasks) {
      const [, projectName, taskName] = taskKey.split("|||");
      let taskRawMinutes = 0;
      const descriptions = [];
      for (const [desc, mins] of descMap) {
        taskRawMinutes += mins;
        descriptions.push(desc);
      }
      const taskRoundedMinutes = roundTask(taskRawMinutes);
      dayTotalRaw += taskRawMinutes;
      dayTotalRounded += taskRoundedMinutes;

      const projectSuffix = ambiguousTaskNames.has(taskName)
        ? ` — ${projectName}`
        : "";
      const rawNote = `  (raw: ${formatRaw(taskRawMinutes)})`;
      lines.push(
        `  ${taskName}${projectSuffix}  ${formatDuration(taskRoundedMinutes)}${rawNote}`
      );
      lines.push(`  ${descriptions.sort().join(", ")}`);
      lines.push("");
    }

    const dayNote =
      dayTotalRaw !== dayTotalRounded
        ? ` (raw: ${formatRaw(dayTotalRaw)})`
        : "";
    lines.push(`  DAY TOTAL  ${formatDuration(dayTotalRounded)}${dayNote}`);
    lines.push("══════════════════════════════════════════════════");

    grandTotalRaw += dayTotalRaw;
    grandTotalRounded += dayTotalRounded;
    weekRaw += dayTotalRaw;
    weekRounded += dayTotalRounded;
    weekDays.push({
      date,
      dayOfWeek: d.toLocaleDateString("en-US", { weekday: "short" }),
      raw: dayTotalRaw,
      rounded: dayTotalRounded,
    });

    // End of week = next date is in a different ISO week, or no next date.
    // Using the ISO week (Mon-Sun) means Sat/Sun entries stay with their
    // own Mon-Fri rather than being pushed into the following week.
    const nextDate = sortedDates[i + 1];
    const thisWeek = isoWeekKey(date);
    const isEndOfWeek = !nextDate || isoWeekKey(nextDate) !== thisWeek;

    if (isEndOfWeek && weekRaw > 0) {
      weekNum++;
      const weekRawNote =
        weekRaw !== weekRounded ? ` (raw: ${formatRaw(weekRaw)})` : "";
      lines.push(
        `  >>> WEEK ${weekNum} TOTAL  ${formatDuration(weekRounded)}${weekRawNote}`
      );
      for (const wd of weekDays) {
        const dRawNote =
          wd.raw !== wd.rounded ? ` (raw: ${formatRaw(wd.raw)})` : "";
        lines.push(
          `      ${wd.dayOfWeek} ${wd.date}  ${formatDuration(wd.rounded)}${dRawNote}`
        );
      }
      lines.push("══════════════════════════════════════════════════");
      weekRaw = 0;
      weekRounded = 0;
      weekDays = [];
    }
  }

  lines.push("");
  lines.push(
    `PERIOD TOTAL: ${formatDuration(grandTotalRounded)} (raw: ${formatRaw(grandTotalRaw)})`
  );
  lines.push(`Period: ${startDate} to ${endDate}`);
  lines.push(
    `Rounding: ${ROUNDING.interval}min ${ROUNDING.method}, min billable: ${ROUNDING.minimumBillable}min`
  );
  return lines.join("\n");
}

function generateRawJson(entries, projects, tasks, clients) {
  return entries.map((e) => {
    const project = projects.get(e.project_id);
    const task = tasks.get(e.task_id);
    const client = project ? clients.get(project.client_id) : null;
    return {
      date: e.start.split("T")[0],
      start: e.start,
      stop: e.stop,
      durationSeconds: e.duration,
      durationMinutes: Math.round(e.duration / 60),
      client: client?.name || null,
      project: project?.name || null,
      task: task?.name || null,
      description: e.description || null,
      billable: e.billable,
      tags: e.tags || [],
    };
  });
}

// --- Main ---

async function main() {
  console.error(`Fetching Toggl data for ${startDate} to ${endDate}...`);
  const toggl = new TogglClient({ token });

  const workspaceId = await toggl.getDefaultWorkspaceId();
  console.error(`Workspace ID: ${workspaceId}`);

  const entries = await toggl.getTimeEntries(workspaceId, { startDate, endDate });
  console.error(`Fetched ${entries.length} time entries`);

  if (entries.length === 0) {
    console.error("No entries found for this period.");
    process.exit(0);
  }

  const projectIds = [
    ...new Set(entries.map((e) => e.project_id).filter(Boolean)),
  ];

  console.error("Fetching projects, tasks, and clients...");
  const [projects, tasks, clients] = await Promise.all([
    toggl.getProjects(workspaceId),
    toggl.getTasks(workspaceId, projectIds),
    toggl.getClients(workspaceId),
  ]);
  console.error(
    `Resolved: ${projects.size} projects, ${tasks.size} tasks, ${clients.size} clients`
  );

  if (args.raw) {
    console.log(JSON.stringify(generateRawJson(entries, projects, tasks, clients), null, 2));
    return;
  }

  if (args["rec-export"]) {
    const payload = buildRecImport(entries, {
      projects,
      tasks,
      clients,
      generatedAt: new Date().toISOString(),
    });
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const { days, excluded } = aggregateByDayTaskDesc(entries, {
    projects,
    tasks,
    clients,
    isTaskExcluded,
  });

  if (args.csv) {
    console.log(generateCsv(days));
  } else if (args.workday) {
    console.log(generateWorkday(days));
  } else {
    console.log(generateReport(days));
  }

  if (excluded.size > 0) {
    console.log("");
    console.log("EXCLUDED TASKS (not in totals above)");
    console.log("──────────────────────────────────────────────────");
    let excludedTotal = 0;
    for (const [taskName, mins] of excluded) {
      console.log(
        `  ${taskName}  ${formatDuration(mins)}  (raw: ${formatRaw(mins)})`
      );
      excludedTotal += mins;
    }
    console.log(
      `  TOTAL EXCLUDED  ${formatDuration(excludedTotal)} (raw: ${formatRaw(excludedTotal)})`
    );
    console.log(`  Patterns: ${excludePatterns.join(", ")}`);
  }

  // Stats to stderr
  const uniqueDescriptions = new Set(entries.map((e) => e.description)).size;
  const uniqueTasks = new Set(entries.map((e) => e.task_id).filter(Boolean)).size;
  console.error("\n--- Stats ---");
  console.error(`Total entries: ${entries.length}`);
  console.error(`Unique descriptions: ${uniqueDescriptions}`);
  console.error(`Unique tasks: ${uniqueTasks}`);
  console.error(`Unique projects: ${projectIds.length}`);
  console.error(`Days with entries: ${days.size}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});