/**
 * RFC 4180 field escaping, plus formula-injection neutralization
 * (CWE-1236): a leading =, +, -, or @ makes many spreadsheet
 * applications treat a cell as a formula (or, historically, a DDE
 * command) even when the cell is quoted. Prefixing such values with a
 * bare apostrophe is the standard mitigation — Excel and LibreOffice
 * both treat a leading apostrophe as "force text" and hide it on
 * display, so the value still reads correctly to a human.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvField(value) {
  let str = String(value ?? "");
  if (FORMULA_TRIGGER.test(str)) str = "'" + str;
  return `"${str.replace(/"/g, '""')}"`;
}
