/**
 * Date range chunking — pure, no I/O.
 *
 * Toggl's Reports API accepts up to a 1-year window per request, so a
 * multi-year history is split into <=365-day chunks and merged. `maxSpanDays`
 * is caller-supplied so the same helper can serve endpoints with other caps.
 */

/**
 * Split [startDate, endDate] (inclusive, "YYYY-MM-DD") into contiguous,
 * non-overlapping chunks of at most `maxSpanDays` days each.
 *
 * @returns Array<{ start, end }> in chronological order. Empty if
 *          startDate is after endDate.
 */
export function chunkDateRange(startDate, endDate, maxSpanDays = 89) {
  const chunks = [];
  const end = new Date(endDate + "T00:00:00Z");
  let chunkStart = new Date(startDate + "T00:00:00Z");

  while (chunkStart <= end) {
    const tentativeEnd = new Date(
      chunkStart.getTime() + (maxSpanDays - 1) * 86400000
    );
    const chunkEnd = tentativeEnd < end ? tentativeEnd : end;
    chunks.push({
      start: chunkStart.toISOString().split("T")[0],
      end: chunkEnd.toISOString().split("T")[0],
    });
    chunkStart = new Date(chunkEnd.getTime() + 86400000);
  }

  return chunks;
}

/**
 * True if `value` is a real calendar date in strict "YYYY-MM-DD" form
 * (e.g. rejects "2026-02-30" — Feb 30 doesn't exist — via a round-trip
 * check, not just a regex shape match).
 */
export function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(value + "T00:00:00Z");
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
