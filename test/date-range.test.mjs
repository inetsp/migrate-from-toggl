import { test } from "node:test";
import { strict as assert } from "node:assert";
import { chunkDateRange, isValidDateString } from "../lib/date-range.mjs";

test("chunkDateRange: range under the cap is a single chunk", () => {
  const chunks = chunkDateRange("2026-01-01", "2026-01-31");
  assert.deepEqual(chunks, [{ start: "2026-01-01", end: "2026-01-31" }]);
});

test("chunkDateRange: single-day range", () => {
  const chunks = chunkDateRange("2026-01-01", "2026-01-01");
  assert.deepEqual(chunks, [{ start: "2026-01-01", end: "2026-01-01" }]);
});

test("chunkDateRange: a full year splits into <=89-day windows covering every day exactly once", () => {
  const chunks = chunkDateRange("2025-01-01", "2025-12-31");
  assert.ok(chunks.length > 1);

  // Contiguous: each chunk starts the day after the previous one ends.
  for (let i = 1; i < chunks.length; i++) {
    const prevEnd = new Date(chunks[i - 1].end + "T00:00:00Z");
    const thisStart = new Date(chunks[i].start + "T00:00:00Z");
    assert.equal(thisStart.getTime() - prevEnd.getTime(), 86400000);
  }

  assert.equal(chunks[0].start, "2025-01-01");
  assert.equal(chunks[chunks.length - 1].end, "2025-12-31");

  for (const { start, end } of chunks) {
    const spanDays =
      (new Date(end + "T00:00:00Z") - new Date(start + "T00:00:00Z")) /
        86400000 +
      1;
    assert.ok(spanDays <= 89, `span ${spanDays} exceeds 89 days`);
  }
});

test("chunkDateRange: exactly maxSpanDays fits in one chunk", () => {
  const chunks = chunkDateRange("2026-01-01", "2026-03-30", 89);
  assert.equal(chunks.length, 1);
});

test("chunkDateRange: start after end returns no chunks", () => {
  const chunks = chunkDateRange("2026-06-01", "2026-01-01");
  assert.deepEqual(chunks, []);
});

test("isValidDateString: accepts real calendar dates", () => {
  assert.equal(isValidDateString("2026-07-20"), true);
  assert.equal(isValidDateString("2026-01-01"), true);
  assert.equal(isValidDateString("2024-02-29"), true); // leap year
});

test("isValidDateString: rejects malformed strings", () => {
  assert.equal(isValidDateString("banana"), false);
  assert.equal(isValidDateString("2026/07/20"), false);
  assert.equal(isValidDateString("2026-7-20"), false);
  assert.equal(isValidDateString(""), false);
});

test("isValidDateString: rejects dates that don't exist", () => {
  assert.equal(isValidDateString("2026-02-30"), false); // Feb has 28 days in 2026
  assert.equal(isValidDateString("2025-02-29"), false); // not a leap year
  assert.equal(isValidDateString("2026-13-01"), false);
});

test("isValidDateString: rejects non-string input", () => {
  assert.equal(isValidDateString(undefined), false);
  assert.equal(isValidDateString(null), false);
});
