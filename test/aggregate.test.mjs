import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  applyRounding,
  applyMinimumBillable,
  makeTaskExcluder,
  aggregateByDayTaskDesc,
  roundTaskDay,
  parseTaskKey,
  detectAmbiguousTaskNames,
  isoWeekKey,
  isoWeekEnd,
  ROUNDING_METHODS,
  DEFAULT_ROUNDING,
} from "../lib/aggregate.mjs";

test("applyRounding: ceil at 15-min interval", () => {
  // Examples taken directly from the business rules wiki:
  // rec.wiki/time-reporting-business-rules.md → "Rounding Examples"
  const r = (m) => applyRounding(m, { interval: 15, method: "ceil" });
  assert.equal(r(0), 0);
  assert.equal(r(7), 15);
  assert.equal(r(15), 15);
  assert.equal(r(22), 30);
  assert.equal(r(60), 60);
  assert.equal(r(73), 75);
  assert.equal(r(210), 210);
  assert.equal(r(213), 225);
});

test("applyRounding: round (nearest)", () => {
  const r = (m) => applyRounding(m, { interval: 15, method: "round" });
  assert.equal(r(7), 0); // 7 is closer to 0 than to 15
  assert.equal(r(8), 15);
  assert.equal(r(22), 15); // 22 is closer to 15 than to 30
  assert.equal(r(23), 30); // 23 is closer to 30
});

test("applyRounding: floor (round down)", () => {
  const r = (m) => applyRounding(m, { interval: 15, method: "floor" });
  assert.equal(r(7), 0);
  assert.equal(r(15), 15);
  assert.equal(r(29), 15);
  assert.equal(r(30), 30);
});

test("applyRounding: legal industry 6-min increments", () => {
  const r = (m) => applyRounding(m, { interval: 6, method: "ceil" });
  assert.equal(r(0), 0);
  assert.equal(r(1), 6);
  assert.equal(r(6), 6);
  assert.equal(r(7), 12);
  assert.equal(r(60), 60);
});

test("applyRounding: 60-min interval (hourly billing)", () => {
  const r = (m) => applyRounding(m, { interval: 60, method: "ceil" });
  assert.equal(r(0), 0);
  assert.equal(r(1), 60);
  assert.equal(r(60), 60);
  assert.equal(r(61), 120);
});

test("applyRounding: interval=0 disables rounding", () => {
  assert.equal(applyRounding(7, { interval: 0, method: "ceil" }), 7);
  assert.equal(applyRounding(213, { interval: 0, method: "ceil" }), 213);
});

test("applyRounding: rejects unknown method", () => {
  assert.throws(
    () => applyRounding(15, { interval: 15, method: "wat" }),
    /Unknown rounding method/
  );
});

test("applyMinimumBillable: zero stays zero (no work, no charge)", () => {
  assert.equal(applyMinimumBillable(0, 15), 0);
});

test("applyMinimumBillable: floors small durations to minimum", () => {
  assert.equal(applyMinimumBillable(1, 15), 15);
  assert.equal(applyMinimumBillable(7, 15), 15);
  assert.equal(applyMinimumBillable(14, 15), 15);
});

test("applyMinimumBillable: leaves durations >= minimum untouched", () => {
  assert.equal(applyMinimumBillable(15, 15), 15);
  assert.equal(applyMinimumBillable(60, 15), 60);
});

test("applyMinimumBillable: minimum=0 is a no-op", () => {
  assert.equal(applyMinimumBillable(7, 0), 7);
});

test("makeTaskExcluder: case-insensitive substring match", () => {
  const exclude = makeTaskExcluder(["Data Migration"]);
  assert.equal(exclude("Data Migration (Phase 2)"), true);
  assert.equal(exclude("data migration review"), true);
  assert.equal(exclude("Support"), false);
  assert.equal(exclude(null), false);
  assert.equal(exclude(""), false);
});

test("makeTaskExcluder: empty patterns matches nothing", () => {
  const exclude = makeTaskExcluder([]);
  assert.equal(exclude("any task"), false);
});

test("makeTaskExcluder: multiple patterns (OR)", () => {
  const exclude = makeTaskExcluder(["foo", "bar"]);
  assert.equal(exclude("FooBaz"), true);
  assert.equal(exclude("not bar yet"), true);
  assert.equal(exclude("baz qux"), false);
});

test("makeTaskExcluder: a blank pattern does not match every task", () => {
  // Regression: "x".includes("") is always true in JS, so an empty or
  // whitespace-only --exclude-task value used to silently exclude
  // everything instead of being a no-op.
  const exclude = makeTaskExcluder([""]);
  assert.equal(exclude("any task"), false);
  assert.equal(exclude("literally anything"), false);

  const excludeWhitespace = makeTaskExcluder(["  "]);
  assert.equal(excludeWhitespace("any task"), false);

  // A real pattern alongside a blank one still works.
  const mixed = makeTaskExcluder(["", "Data Migration"]);
  assert.equal(mixed("Data Migration review"), true);
  assert.equal(mixed("unrelated task"), false);
});

test("aggregateByDayTaskDesc: sums identical descriptions on same task/day", () => {
  const entries = [
    { start: "2026-04-29T09:00:00Z", duration: 1800, project_id: 1, task_id: 10, description: "JIRA-1234" },
    { start: "2026-04-29T11:00:00Z", duration: 600, project_id: 1, task_id: 10, description: "JIRA-1234" },
    { start: "2026-04-29T13:00:00Z", duration: 1200, project_id: 1, task_id: 10, description: "JIRA-1234" },
  ];
  const projects = new Map([[1, { id: 1, name: "Proj", client_id: 100 }]]);
  const tasks = new Map([[10, { id: 10, name: "Task" }]]);
  const clients = new Map([[100, { id: 100, name: "Client" }]]);

  const { days } = aggregateByDayTaskDesc(entries, { projects, tasks, clients });
  const day = days.get("2026-04-29");
  const taskMap = day.get("Client|||Proj|||Task");
  assert.equal(taskMap.get("JIRA-1234"), 60); // 30 + 10 + 20 = 60 minutes
});

test("aggregateByDayTaskDesc: keeps distinct descriptions separate", () => {
  const entries = [
    { start: "2026-04-29T09:00:00Z", duration: 1800, project_id: 1, task_id: 10, description: "JIRA-1234" },
    { start: "2026-04-29T11:00:00Z", duration: 600, project_id: 1, task_id: 10, description: "JIRA-5678" },
  ];
  const projects = new Map([[1, { id: 1, name: "Proj", client_id: 100 }]]);
  const tasks = new Map([[10, { id: 10, name: "Task" }]]);
  const clients = new Map([[100, { id: 100, name: "Client" }]]);

  const { days } = aggregateByDayTaskDesc(entries, { projects, tasks, clients });
  const taskMap = days.get("2026-04-29").get("Client|||Proj|||Task");
  assert.equal(taskMap.get("JIRA-1234"), 30);
  assert.equal(taskMap.get("JIRA-5678"), 10);
});

test("aggregateByDayTaskDesc: filters excluded tasks into a separate bucket", () => {
  const entries = [
    { start: "2026-04-29T09:00:00Z", duration: 1800, project_id: 1, task_id: 10, description: "billable" },
    { start: "2026-04-29T10:00:00Z", duration: 2640, project_id: 1, task_id: 11, description: "deferred" },
  ];
  const projects = new Map([[1, { id: 1, name: "Proj", client_id: 100 }]]);
  const tasks = new Map([
    [10, { id: 10, name: "Support" }],
    [11, { id: 11, name: "Data Migration (Phase 2)" }],
  ]);
  const clients = new Map([[100, { id: 100, name: "Client" }]]);
  const isTaskExcluded = makeTaskExcluder(["Data Migration"]);

  const { days, excluded } = aggregateByDayTaskDesc(entries, {
    projects, tasks, clients, isTaskExcluded,
  });

  // Active task is in days
  assert.equal(days.get("2026-04-29").get("Client|||Proj|||Support").get("billable"), 30);
  // Excluded task is parked
  assert.equal(excluded.get("Data Migration (Phase 2)"), 44);
  // Excluded task is NOT in days
  assert.equal(days.get("2026-04-29").size, 1);
});

test("aggregateByDayTaskDesc: handles missing project/task/client metadata", () => {
  const entries = [
    { start: "2026-04-29T09:00:00Z", duration: 600, project_id: null, task_id: null, description: "ad-hoc" },
  ];
  const { days } = aggregateByDayTaskDesc(entries);
  const dayMap = days.get("2026-04-29");
  const key = "(no client)|||(no project)|||(no task)";
  assert.equal(dayMap.get(key).get("ad-hoc"), 10);
});

test("aggregateByDayTaskDesc: strips terminal escape sequences and bidi overrides from names/descriptions", () => {
  const entries = [
    {
      start: "2026-04-29T09:00:00Z",
      duration: 600,
      project_id: 1,
      task_id: 1,
      description: "\x1b]0;pwned\x07Refund ‮1000$‬ not 1$",
    },
  ];
  const projects = new Map([[1, { id: 1, name: "Proj\x1b[8m", client_id: 1 }]]);
  const tasks = new Map([[1, { id: 1, name: "Task\x07Name" }]]);
  const clients = new Map([[1, { id: 1, name: "Client‮Name" }]]);

  const { days } = aggregateByDayTaskDesc(entries, { projects, tasks, clients });
  const dayMap = days.get("2026-04-29");
  const [taskKey, descMap] = [...dayMap.entries()][0];

  assert.ok(!taskKey.includes("\x1b"));
  assert.ok(!taskKey.includes("\x07"));
  const [description] = [...descMap.keys()];
  assert.ok(!description.includes("\x1b"));
  assert.ok(!description.includes("\x07"));
  // ESC/BEL bytes are gone (the terminal can no longer act on them); the
  // leftover printable characters from the OSC sequence's payload are
  // inert text now, and the bidi override around "1000$" is also gone.
  assert.equal(description, "]0;pwnedRefund 1000$ not 1$");
});

test("roundTaskDay: full task-per-day pipeline (sum -> ceil -> minimum)", () => {
  // 2 minutes raw -> ceil to 15 -> minimum already met
  assert.deepEqual(roundTaskDay(2), { raw: 2, rounded: 15 });
  // 22 minutes raw -> ceil to 30
  assert.deepEqual(roundTaskDay(22), { raw: 22, rounded: 30 });
  // exact boundary, no change
  assert.deepEqual(roundTaskDay(15), { raw: 15, rounded: 15 });
  // 0 -> 0 (no work, no charge)
  assert.deepEqual(roundTaskDay(0), { raw: 0, rounded: 0 });
});

test("DEFAULT_ROUNDING matches the Standard European Consulting template", () => {
  assert.deepEqual(DEFAULT_ROUNDING, {
    interval: 15,
    method: "ceil",
    minimumBillable: 15,
  });
});

test("ROUNDING_METHODS: list of supported methods", () => {
  assert.deepEqual(ROUNDING_METHODS, ["ceil", "round", "floor"]);
});

test("parseTaskKey: splits the three-part key", () => {
  assert.deepEqual(parseTaskKey("Acme|||Website|||Frontend"), {
    client: "Acme",
    project: "Website",
    task: "Frontend",
  });
});

test("aggregateByDayTaskDesc: same task name under different projects stays separate", () => {
  // Regression test for the May 2026 case: two Contoso Nordics projects each had a
  // task literally named "Development". Previously
  // the invoice script merged these silently because it keyed by task
  // name only. The library-level key MUST keep them separate.
  const entries = [
    { start: "2026-05-06T08:00:00Z", duration: 14400, project_id: 1, task_id: 10, description: "JIRA-9012" },
    { start: "2026-05-06T13:00:00Z", duration: 900,   project_id: 2, task_id: 20, description: "PO is completed" },
  ];
  const projects = new Map([
    [1, { id: 1, name: "Website Platform", client_id: 100 }],
    [2, { id: 2, name: "Data Migration Backend", client_id: 100 }],
  ]);
  const tasks = new Map([
    [10, { id: 10, name: "Development" }],
    [20, { id: 20, name: "Development" }],
  ]);
  const clients = new Map([[100, { id: 100, name: "Contoso Nordics" }]]);

  const { days } = aggregateByDayTaskDesc(entries, { projects, tasks, clients });
  const dayMap = days.get("2026-05-06");

  // Two distinct taskKeys despite identical task names
  assert.equal(dayMap.size, 2);
  const websitePlatformKey = "Contoso Nordics|||Website Platform|||Development";
  const dataMigrationKey = "Contoso Nordics|||Data Migration Backend|||Development";
  assert.equal(dayMap.get(websitePlatformKey).get("JIRA-9012"), 240);
  assert.equal(dayMap.get(dataMigrationKey).get("PO is completed"), 15);
});

test("detectAmbiguousTaskNames: flags task names appearing under multiple projects", () => {
  // Build the same structure as the regression test above
  const entries = [
    { start: "2026-05-06T08:00:00Z", duration: 600, project_id: 1, task_id: 10, description: "a" },
    { start: "2026-05-06T13:00:00Z", duration: 600, project_id: 2, task_id: 20, description: "b" },
    { start: "2026-05-06T15:00:00Z", duration: 600, project_id: 1, task_id: 11, description: "c" },
  ];
  const projects = new Map([
    [1, { id: 1, name: "Project A", client_id: 100 }],
    [2, { id: 2, name: "Project B", client_id: 100 }],
  ]);
  const tasks = new Map([
    [10, { id: 10, name: "Shared" }],   // under Project A
    [20, { id: 20, name: "Shared" }],   // also under Project B — ambiguous
    [11, { id: 11, name: "Unique" }],   // only Project A
  ]);
  const clients = new Map([[100, { id: 100, name: "Client" }]]);

  const { days } = aggregateByDayTaskDesc(entries, { projects, tasks, clients });
  const ambiguous = detectAmbiguousTaskNames(days);

  assert.equal(ambiguous.has("Shared"), true);
  assert.equal(ambiguous.has("Unique"), false);
  assert.equal(ambiguous.size, 1);
});

test("detectAmbiguousTaskNames: empty when no overlap", () => {
  const entries = [
    { start: "2026-05-06T08:00:00Z", duration: 600, project_id: 1, task_id: 10, description: "a" },
  ];
  const projects = new Map([[1, { id: 1, name: "Project A", client_id: 100 }]]);
  const tasks = new Map([[10, { id: 10, name: "Solo" }]]);
  const clients = new Map([[100, { id: 100, name: "Client" }]]);

  const { days } = aggregateByDayTaskDesc(entries, { projects, tasks, clients });
  assert.equal(detectAmbiguousTaskNames(days).size, 0);
});

test("isoWeekKey: weekdays map to the same Monday", () => {
  // June 1 2026 is a Monday
  assert.equal(isoWeekKey("2026-06-01"), "2026-06-01"); // Mon
  assert.equal(isoWeekKey("2026-06-02"), "2026-06-01"); // Tue
  assert.equal(isoWeekKey("2026-06-05"), "2026-06-01"); // Fri
});

test("isoWeekKey: Sat and Sun stay with their preceding Mon-Fri", () => {
  // Regression test for the June 2026 case: weekend work was being
  // pushed into the FOLLOWING week's recap. Sat and Sun belong to the
  // ISO week starting on the preceding Monday.
  assert.equal(isoWeekKey("2026-06-06"), "2026-06-01"); // Sat
  assert.equal(isoWeekKey("2026-06-07"), "2026-06-01"); // Sun
  assert.equal(isoWeekKey("2026-06-08"), "2026-06-08"); // next Mon, new week
});

test("isoWeekEnd: returns the Sunday of the ISO week", () => {
  assert.equal(isoWeekEnd("2026-06-01"), "2026-06-07");
  assert.equal(isoWeekEnd("2026-06-08"), "2026-06-14");
  // Edge: week spanning month boundary
  assert.equal(isoWeekEnd("2026-06-29"), "2026-07-05");
});