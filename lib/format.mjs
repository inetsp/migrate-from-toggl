/**
 * Duration formatting.
 *
 * REC supports three duration formats per the configuration template
 * specification (REC's internal configuration-templates doc, durationFormat field):
 *
 *   - hmm           -> "7:30"   (Workday, most US/UK systems)
 *   - dot           -> "7.5"    (SAP, many international systems)
 *   - comma         -> "7,5"    (Finnish/German/French systems)
 *
 * The `raw` formatter always shows h:mm (matching Toggl's display) and
 * appends the decimal form as secondary when --format is decimal, so users
 * can verify entries against Toggl 1:1 while still copy-pasting the chosen
 * primary format into the target system.
 */

export const FORMATS = ["hmm", "dot", "comma"];

export function formatHmm(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function formatDecimal(totalMinutes, separator) {
  const decimal = totalMinutes / 60;
  const str = decimal.toFixed(2).replace(/\.?0+$/, "");
  return separator === "," ? str.replace(".", ",") : str;
}

/**
 * Build a pair of formatters for a chosen format.
 * Returns `{ format, formatRaw }` where:
 *   - format(min)    -> primary format (the value to paste into target system)
 *   - formatRaw(min) -> raw value, h:mm primary; for decimal formats also
 *                       appends "/ 1,62" so users can cross-check.
 */
export function makeFormatters(format) {
  if (!FORMATS.includes(format)) {
    throw new Error(
      `Unknown format: ${format}. Must be one of: ${FORMATS.join(", ")}`
    );
  }

  const primary = (totalMinutes) => {
    if (format === "dot") return formatDecimal(totalMinutes, ".");
    if (format === "comma") return formatDecimal(totalMinutes, ",");
    return formatHmm(totalMinutes);
  };

  const raw = (totalMinutes) => {
    const hmm = formatHmm(totalMinutes);
    if (format === "hmm") return hmm;
    const sep = format === "comma" ? "," : ".";
    return `${hmm} / ${formatDecimal(totalMinutes, sep)}`;
  };

  return { format: primary, formatRaw: raw };
}