/**
 * REC-native export format — the forward-compatible bridge between this
 * standalone CLI and REC's own "Import from Toggl" feature (planned per
 * REC's internal business-rules spec, "Input Sources Beyond
 * Manual Entry"). A file saved today should be droppable straight into
 * REC once that import feature ships, with no re-extraction from Toggl.
 *
 * Deliberately entry-level, not pre-aggregated or pre-rounded: rounding
 * is a per-client/per-project configuration in REC, so baking it in here
 * would throw away information REC needs to apply its own rules later.
 */

export const REC_IMPORT_SCHEMA_VERSION = "rec-import-v1";

/**
 * Build the REC import payload from raw Toggl entries plus resolved
 * projects/tasks/clients maps (same shape as TogglClient's getters).
 *
 * @returns { schemaVersion, source, generatedAt, hierarchy, entries }
 *   hierarchy  distinct { client, project, task } combinations seen,
 *              so REC can pre-create the structure before entries land
 *   entries    one row per Toggl time entry, hierarchy resolved to names
 */
export function buildRecImport(entries, { projects, tasks, clients, generatedAt }) {
  const resolvedEntries = entries.map((e) => {
    const project = projects.get(e.project_id);
    const task = tasks.get(e.task_id);
    const client = project ? clients.get(project.client_id) : null;
    return {
      date: e.start.split("T")[0],
      start: e.start,
      stop: e.stop,
      durationMinutes: Math.round(e.duration / 60),
      client: client?.name || null,
      project: project?.name || null,
      task: task?.name || null,
      description: e.description || null,
      billable: e.billable,
      tags: e.tags || [],
    };
  });

  const hierarchySeen = new Map();
  for (const e of resolvedEntries) {
    const key = `${e.client}|||${e.project}|||${e.task}`;
    if (!hierarchySeen.has(key)) {
      hierarchySeen.set(key, { client: e.client, project: e.project, task: e.task });
    }
  }

  return {
    schemaVersion: REC_IMPORT_SCHEMA_VERSION,
    source: "toggl",
    generatedAt,
    hierarchy: [...hierarchySeen.values()],
    entries: resolvedEntries,
  };
}
