import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildRecImport, REC_IMPORT_SCHEMA_VERSION } from "../lib/rec-export.mjs";

const clients = new Map([[1, { id: 1, name: "Acme Corp" }]]);
const projects = new Map([[10, { id: 10, name: "IT Services 2026", client_id: 1 }]]);
const tasks = new Map([[100, { id: 100, name: "Website Redesign" }]]);

const entries = [
  {
    start: "2026-04-01T09:00:00Z",
    stop: "2026-04-01T10:00:00Z",
    duration: 3600,
    project_id: 10,
    task_id: 100,
    description: "Sprint planning",
    billable: true,
    tags: [],
  },
  {
    start: "2026-04-01T11:00:00Z",
    stop: "2026-04-01T11:30:00Z",
    duration: 1800,
    project_id: 10,
    task_id: 100,
    description: "Sprint planning",
    billable: true,
    tags: [],
  },
  {
    start: "2026-04-02T09:00:00Z",
    stop: "2026-04-02T09:15:00Z",
    duration: 900,
    project_id: null,
    task_id: null,
    description: "ad hoc fix",
    billable: false,
    tags: ["urgent"],
  },
];

test("buildRecImport: stamps the schema version and source", () => {
  const result = buildRecImport(entries, { projects, tasks, clients, generatedAt: "2026-07-20T00:00:00Z" });
  assert.equal(result.schemaVersion, REC_IMPORT_SCHEMA_VERSION);
  assert.equal(result.source, "toggl");
  assert.equal(result.generatedAt, "2026-07-20T00:00:00Z");
});

test("buildRecImport: resolves entries to client/project/task names, one row per entry (no aggregation)", () => {
  const result = buildRecImport(entries, { projects, tasks, clients, generatedAt: "x" });
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0].client, "Acme Corp");
  assert.equal(result.entries[0].project, "IT Services 2026");
  assert.equal(result.entries[0].task, "Website Redesign");
  assert.equal(result.entries[0].durationMinutes, 60);
  assert.equal(result.entries[2].client, null);
  assert.equal(result.entries[2].tags[0], "urgent");
});

test("buildRecImport: hierarchy lists each distinct client/project/task combo once", () => {
  const result = buildRecImport(entries, { projects, tasks, clients, generatedAt: "x" });
  assert.equal(result.hierarchy.length, 2);
  assert.deepEqual(result.hierarchy[0], {
    client: "Acme Corp",
    project: "IT Services 2026",
    task: "Website Redesign",
  });
  assert.deepEqual(result.hierarchy[1], { client: null, project: null, task: null });
});

test("buildRecImport: empty entries yields empty hierarchy and entries", () => {
  const result = buildRecImport([], { projects, tasks, clients, generatedAt: "x" });
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.hierarchy, []);
});
