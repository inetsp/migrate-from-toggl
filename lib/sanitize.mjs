/**
 * Strip characters that have no legitimate place in a single-line time
 * entry label but do have well-documented abuse potential when printed
 * to a terminal or opened in a spreadsheet:
 *
 *   - ASCII control chars (0x00-0x1F, 0x7F), including ESC — terminal
 *     escape-sequence injection (concealed text, rewritten terminal
 *     title, and worse in some emulators).
 *   - Unicode bidi override/isolate controls (U+202A-E, U+2066-9) —
 *     "Trojan Source"-style visual reordering of digits or text.
 *   - Zero-width characters (U+200B-D, U+FEFF) — invisible content that
 *     can hide or alter apparent meaning.
 *
 * Applied to text sourced from Toggl (descriptions, client/project/task
 * names) before it reaches a human-facing report, CSV, or invoice.
 * Deliberately NOT applied to --raw / --rec-export JSON: that output is
 * meant to be a lossless, machine-readable copy, and JSON.stringify
 * already escapes these characters safely for that context.
 *
 * The character class is built from explicit code points at runtime
 * (not typed as literal characters in this file) so the source stays
 * plain ASCII and unambiguous.
 */
const UNSAFE_RANGES = [
  [0x00, 0x1f], // C0 controls, incl. ESC (0x1b)
  [0x7f, 0x7f], // DEL
  [0x202a, 0x202e], // bidi embedding/override
  [0x2066, 0x2069], // bidi isolates
  [0x200b, 0x200d], // zero-width space / ZWNJ / ZWJ
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
];

const charClass = UNSAFE_RANGES.map(([start, end]) =>
  start === end
    ? String.fromCodePoint(start)
    : `${String.fromCodePoint(start)}-${String.fromCodePoint(end)}`
).join("");

const UNSAFE_CHARS = new RegExp(`[${charClass}]`, "gu");

export function sanitizeDisplayText(value) {
  if (value == null) return value;
  return String(value).replace(UNSAFE_CHARS, "");
}
