import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatHmm,
  formatDecimal,
  makeFormatters,
  FORMATS,
} from "../lib/format.mjs";

test("formatHmm: typical durations", () => {
  assert.equal(formatHmm(0), "0:00");
  assert.equal(formatHmm(7), "0:07");
  assert.equal(formatHmm(15), "0:15");
  assert.equal(formatHmm(60), "1:00");
  assert.equal(formatHmm(75), "1:15");
  assert.equal(formatHmm(90), "1:30");
  assert.equal(formatHmm(528), "8:48"); // verified against real April data
  assert.equal(formatHmm(7335), "122:15");
});

test("formatDecimal: dot separator", () => {
  assert.equal(formatDecimal(0, "."), "0");
  assert.equal(formatDecimal(15, "."), "0.25");
  assert.equal(formatDecimal(30, "."), "0.5");
  assert.equal(formatDecimal(45, "."), "0.75");
  assert.equal(formatDecimal(60, "."), "1");
  assert.equal(formatDecimal(75, "."), "1.25");
  assert.equal(formatDecimal(90, "."), "1.5");
  assert.equal(formatDecimal(105, "."), "1.75");
  assert.equal(formatDecimal(540, "."), "9");
});

test("formatDecimal: comma separator (European)", () => {
  assert.equal(formatDecimal(15, ","), "0,25");
  assert.equal(formatDecimal(90, ","), "1,5");
  assert.equal(formatDecimal(540, ","), "9");
  assert.equal(formatDecimal(528, ","), "8,8");
});

test("formatDecimal: trailing zero stripping", () => {
  assert.equal(formatDecimal(60, "."), "1"); // not "1.00"
  assert.equal(formatDecimal(30, "."), "0.5"); // not "0.50"
});

test("makeFormatters: hmm format", () => {
  const { format, formatRaw } = makeFormatters("hmm");
  assert.equal(format(75), "1:15");
  assert.equal(formatRaw(75), "1:15");
  // In hmm mode, raw matches primary — no secondary decimal
});

test("makeFormatters: comma format adds h:mm secondary in raw", () => {
  const { format, formatRaw } = makeFormatters("comma");
  assert.equal(format(75), "1,25");
  assert.equal(formatRaw(75), "1:15 / 1,25");
  assert.equal(formatRaw(528), "8:48 / 8,8");
});

test("makeFormatters: dot format adds h:mm secondary in raw", () => {
  const { format, formatRaw } = makeFormatters("dot");
  assert.equal(format(75), "1.25");
  assert.equal(formatRaw(75), "1:15 / 1.25");
});

test("makeFormatters: rejects unknown format", () => {
  assert.throws(() => makeFormatters("nope"), /Unknown format/);
});

test("FORMATS: list of supported formats", () => {
  assert.deepEqual(FORMATS, ["hmm", "dot", "comma"]);
});