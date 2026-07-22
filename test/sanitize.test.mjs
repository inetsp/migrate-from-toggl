import { test } from "node:test";
import { strict as assert } from "node:assert";
import { sanitizeDisplayText } from "../lib/sanitize.mjs";

test("sanitizeDisplayText: strips ANSI/terminal escape sequences", () => {
  const input = "\x1b[8mHIDDEN\x1b[0m\x1b]0;pwned\x07visible text";
  const result = sanitizeDisplayText(input);
  assert.ok(!result.includes("\x1b"));
  assert.ok(!result.includes("\x07"));
});

test("sanitizeDisplayText: strips C0 control characters and DEL", () => {
  assert.equal(sanitizeDisplayText("a\x00b\x1fc\x7fd"), "abcd");
});

test("sanitizeDisplayText: strips Unicode bidi override characters", () => {
  const input = "Refund ‮1000$‬ not 1$";
  assert.equal(sanitizeDisplayText(input), "Refund 1000$ not 1$");
});

test("sanitizeDisplayText: strips zero-width characters and BOM", () => {
  const input = "with​zero‌width‍chars﻿";
  assert.equal(sanitizeDisplayText(input), "withzerowidthchars");
});

test("sanitizeDisplayText: leaves normal text untouched", () => {
  assert.equal(sanitizeDisplayText("Sprint planning, JIRA-1234"), "Sprint planning, JIRA-1234");
});

test("sanitizeDisplayText: passes through null/undefined unchanged", () => {
  assert.equal(sanitizeDisplayText(null), null);
  assert.equal(sanitizeDisplayText(undefined), undefined);
});

test("sanitizeDisplayText: coerces non-string input to string", () => {
  assert.equal(sanitizeDisplayText(42), "42");
});
