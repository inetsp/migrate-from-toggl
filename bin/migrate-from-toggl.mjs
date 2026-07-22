#!/usr/bin/env node
/**
 * migrate-from-toggl — command dispatcher.
 *
 * Routes `migrate-from-toggl <command> [options]` to the matching script,
 * passing through the remaining arguments and the environment (so
 * TOGGL_API_TOKEN and per-command flags work exactly as documented).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COMMANDS = { report: "toggl-report.mjs", invoice: "toggl-invoice.mjs" };
const [command, ...rest] = process.argv.slice(2);

const USAGE = `migrate-from-toggl — pull your Toggl time entries into clean reports & invoices

Usage:
  migrate-from-toggl <command> [options]

Commands:
  report     Aggregated, correctly-rounded time report (CSV / JSON / rec-export)
  invoice    Billable summary grouped for invoicing

Setup:
  Set your Toggl API token (from https://track.toggl.com/profile):
    export TOGGL_API_TOKEN=your-token

Examples:
  npx migrate-from-toggl report --start 2024-01-01 --end 2024-12-31
  npx migrate-from-toggl report --csv > report.csv
  npx migrate-from-toggl invoice --start 2024-04-01 --end 2024-04-30

Run a command with --help for its full option list.`;

if (!command || command === "-h" || command === "--help" || command === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (!COMMANDS[command]) {
  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [join(here, COMMANDS[command]), ...rest], { stdio: "inherit" });
process.exit(result.status ?? 1);
