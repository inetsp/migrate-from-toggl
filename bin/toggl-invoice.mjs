#!/usr/bin/env node

/**
 * Toggl -> REC invoice summary.
 *
 * Weekly and monthly task totals (raw -> rounded) for invoicing. When
 * entries span multiple projects, rows are grouped by project with
 * per-project subtotals — different projects typically map to different
 * POs / invoice line items.
 *
 * Excluded tasks (e.g. waiting on PO) are surfaced in a separate
 * "deferred" footer so nothing gets lost.
 *
 * Usage:
 *   node --env-file=.env bin/toggl-invoice.mjs
 *   ... --start 2026-04-01 --end 2026-04-30
 *   ... --format hmm|dot|comma     duration format (default hmm)
 *   ... --exclude-task "Data Migration"    defer tasks matching the substring (repeatable)
 */

import { parseArgs } from "node:util";
import { TogglClient } from "../lib/toggl-api.mjs";
import {
  aggregateByDayTaskDesc,
  applyRounding,
  applyMinimumBillable,
  makeTaskExcluder,
  parseTaskKey,
  isoWeekKey,
  isoWeekEnd,
  DEFAULT_ROUNDING,
} from "../lib/aggregate.mjs";
import { makeFormatters, FORMATS } from "../lib/format.mjs";
import { isValidDateString } from "../lib/date-range.mjs";

const ROUNDING = DEFAULT_ROUNDING;

const USAGE = `Toggl -> REC invoice summary.

Usage:
  node --env-file=.env bin/toggl-invoice.mjs
  node --env-file=.env bin/toggl-invoice.mjs --start 2026-04-01 --end 2026-04-30

Flags:
  --start YYYY-MM-DD        Period start (default: first of current month)
  --end YYYY-MM-DD          Period end (default: today)
  --format hmm|dot|comma    Output duration format (default: hmm)
  --exclude-task <pattern>  Defer tasks matching the substring; repeatable
  --help, -h                Show this help
`;

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      start: { type: "string", default: "" },
      end: { type: "string", default: "" },
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

const token = process.env.TOGGL_API_TOKEN;
if (!token) {
  console.error("Error: Set TOGGL_API_TOKEN env var");
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

const { format: fmt, formatRaw: fmtRaw } = makeFormatters(args.format);
const isTaskExcluded = makeTaskExcluder(args["exclude-task"] || []);
const excludePatterns = (args["exclude-task"] || []).map((p) => p.toLowerCase());

function roundTask(rawMinutes) {
  return applyMinimumBillable(
    applyRounding(rawMinutes, ROUNDING),
    ROUNDING.minimumBillable
  );
}

// Week boundaries come from the library (ISO week: Mon-Sun).

/**
 * Group totals by project for the given map of taskKey -> {raw, rounded}.
 * Returns a Map<projectLabel, Map<taskName, {raw, rounded}>> in the order
 * projects first appear in the input.
 */
function groupByProject(taskTotals) {
  const byProject = new Map();
  for (const [taskKey, data] of taskTotals) {
    const { project, task } = parseTaskKey(taskKey);
    if (!byProject.has(project)) byProject.set(project, new Map());
    byProject.get(project).set(task, data);
  }
  return byProject;
}

async function main() {
  console.error(`Fetching ${startDate} to ${endDate}...`);
  const toggl = new TogglClient({ token });

  const ws = await toggl.getDefaultWorkspaceId();
  const entries = await toggl.getTimeEntries(ws, { startDate, endDate });
  const projectIds = [
    ...new Set(entries.map((e) => e.project_id).filter(Boolean)),
  ];
  const [projects, tasks, clients] = await Promise.all([
    toggl.getProjects(ws),
    toggl.getTasks(ws, projectIds),
    toggl.getClients(ws),
  ]);

  // Aggregate via the library (single source of truth for key structure)
  const { days, excluded } = aggregateByDayTaskDesc(entries, {
    projects,
    tasks,
    clients,
    isTaskExcluded,
  });

  // Roll up day -> (week, month) per taskKey, applying task-per-day rounding
  const weekTotals = new Map(); // weekKey -> Map<taskKey, {raw, rounded}>
  const monthTotals = new Map(); // taskKey -> {raw, rounded}

  for (const [date, dayMap] of [...days.entries()].sort()) {
    const wk = isoWeekKey(date);
    if (!weekTotals.has(wk)) weekTotals.set(wk, new Map());
    const wkMap = weekTotals.get(wk);

    for (const [taskKey, descMap] of dayMap) {
      let raw = 0;
      for (const mins of descMap.values()) raw += mins;
      const rounded = roundTask(raw);

      if (!wkMap.has(taskKey)) wkMap.set(taskKey, { raw: 0, rounded: 0 });
      const wkEntry = wkMap.get(taskKey);
      wkEntry.raw += raw;
      wkEntry.rounded += rounded;

      if (!monthTotals.has(taskKey)) monthTotals.set(taskKey, { raw: 0, rounded: 0 });
      const mEntry = monthTotals.get(taskKey);
      mEntry.raw += raw;
      mEntry.rounded += rounded;
    }
  }

  // Decide layout: flat if a single project; grouped-by-project otherwise
  const allProjects = new Set();
  for (const taskKey of monthTotals.keys()) {
    allProjects.add(parseTaskKey(taskKey).project);
  }
  const multipleProjects = allProjects.size > 1;

  // Layout constants
  const col1 = 50;
  const rawWidth = args.format === "hmm" ? 6 : 14;

  function printTaskRow(label, data, indent = "  ") {
    const trimmed = label.substring(0, col1 - indent.length).padEnd(col1 - indent.length);
    console.log(
      `${indent}${trimmed}${fmtRaw(data.raw).padStart(rawWidth)} → ${fmt(data.rounded).padStart(6)}`
    );
  }

  function printSubtotalRow(label, raw, rounded, indent = "  ") {
    const trimmed = label.padEnd(col1 - indent.length);
    console.log(
      `${indent}${trimmed}${fmtRaw(raw).padStart(rawWidth)} → ${fmt(rounded).padStart(6)}`
    );
  }

  console.log("");
  console.log(`INVOICE SUMMARY: ${startDate} → ${endDate}`);
  console.log("═".repeat(70));

  // Weekly breakdown
  for (const [weekKey, wkMap] of [...weekTotals.entries()].sort()) {
    let weekRaw = 0;
    let weekRounded = 0;

    console.log("");
    console.log(`Week ${weekKey} → ${isoWeekEnd(weekKey)}`);
    console.log("─".repeat(70));

    if (multipleProjects) {
      const byProject = groupByProject(wkMap);
      for (const [projectName, taskMap] of byProject) {
        console.log(`  ${projectName}`);
        let projRaw = 0;
        let projRounded = 0;
        for (const [taskName, data] of [...taskMap.entries()].sort()) {
          printTaskRow(taskName, data, "    ");
          projRaw += data.raw;
          projRounded += data.rounded;
        }
        printSubtotalRow("subtotal", projRaw, projRounded, "    ");
        weekRaw += projRaw;
        weekRounded += projRounded;
      }
    } else {
      for (const [taskKey, data] of [...wkMap.entries()].sort()) {
        const { task } = parseTaskKey(taskKey);
        printTaskRow(task, data);
        weekRaw += data.raw;
        weekRounded += data.rounded;
      }
    }
    printSubtotalRow("WEEK TOTAL", weekRaw, weekRounded);
  }

  // Month total
  let totalRaw = 0;
  let totalRounded = 0;

  console.log("");
  console.log("═".repeat(70));
  console.log("MONTH TOTAL");
  console.log("═".repeat(70));

  if (multipleProjects) {
    const byProject = groupByProject(monthTotals);
    for (const [projectName, taskMap] of byProject) {
      console.log(`  ${projectName}`);
      let projRaw = 0;
      let projRounded = 0;
      for (const [taskName, data] of [...taskMap.entries()].sort()) {
        printTaskRow(taskName, data, "    ");
        projRaw += data.raw;
        projRounded += data.rounded;
      }
      printSubtotalRow("subtotal", projRaw, projRounded, "    ");
      totalRaw += projRaw;
      totalRounded += projRounded;
    }
  } else {
    for (const [taskKey, data] of [...monthTotals.entries()].sort()) {
      const { task } = parseTaskKey(taskKey);
      printTaskRow(task, data);
      totalRaw += data.raw;
      totalRounded += data.rounded;
    }
  }

  console.log("─".repeat(70));
  printSubtotalRow("TOTAL", totalRaw, totalRounded);
  if (totalRaw > 0) {
    console.log(
      `  ${"Rounding added".padEnd(col1)}${fmtRaw(totalRounded - totalRaw).padStart(rawWidth)}    (${Math.round(((totalRounded - totalRaw) / totalRaw) * 100)}%)`
    );
  }
  console.log("");
  console.log(
    `  Rounding: ${ROUNDING.interval}min ${ROUNDING.method}, scope: task/day, min billable: ${ROUNDING.minimumBillable}min`
  );

  // Excluded tasks (deferred to a later invoice)
  if (excluded.size > 0) {
    console.log("");
    console.log("═".repeat(70));
    console.log("EXCLUDED FROM INVOICE (deferred — not in totals above)");
    console.log("═".repeat(70));
    let excludedTotalRaw = 0;
    let excludedTotalRounded = 0;
    for (const taskName of [...excluded.keys()].sort()) {
      const raw = excluded.get(taskName);
      const rounded = roundTask(raw);
      excludedTotalRaw += raw;
      excludedTotalRounded += rounded;
      printTaskRow(taskName, { raw, rounded });
    }
    console.log("─".repeat(70));
    printSubtotalRow("DEFERRED TOTAL", excludedTotalRaw, excludedTotalRounded);
    console.log(`  Patterns excluded: ${excludePatterns.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
