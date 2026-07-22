import { test } from "node:test";
import { strict as assert } from "node:assert";
import { csvField } from "../lib/csv.mjs";

test("csvField: quotes a plain value", () => {
  assert.equal(csvField("hello"), '"hello"');
});

test("csvField: doubles embedded double quotes (RFC 4180)", () => {
  assert.equal(csvField('He said "hi"'), '"He said ""hi"""');
});

test("csvField: neutralizes formula-injection triggers with a leading apostrophe", () => {
  assert.equal(csvField("=cmd|'/c calc.exe'!A0"), "\"'=cmd|'/c calc.exe'!A0\"");
  assert.equal(csvField("+1234"), "\"'+1234\"");
  assert.equal(csvField("-1234"), "\"'-1234\"");
  assert.equal(csvField("@SUM(A1)"), "\"'@SUM(A1)\"");
});

test("csvField: does not flag a value that merely contains = later in the string", () => {
  assert.equal(csvField("A=B"), '"A=B"');
});

test("csvField: handles null/undefined as empty string", () => {
  assert.equal(csvField(null), '""');
  assert.equal(csvField(undefined), '""');
});
