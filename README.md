# migrate-from-toggl

**Get your time entries out of Toggl — and into clean, correctly-rounded client reports and invoices.** Free, open-source, no signup, nothing to install beyond Node.

Your whole history, not just the last three months. Correct sum-then-round math. Plain output you can paste straight into a client's timesheet or invoice.

```bash
export TOGGL_API_TOKEN=your-token
npx migrate-from-toggl report --start 2020-01-01 --end 2024-12-31
```

That's it — no clone, no `npm install`. (Grab your API token from [track.toggl.com/profile](https://track.toggl.com/profile).)

---

## What you get

Two commands:

- **`report`** — an aggregated, correctly-rounded time report. Human-readable by default; `--csv` for spreadsheets, `--workday` for compact per-day entry, `--rec-export` for a lossless JSON archive.
- **`invoice`** — a billable summary grouped for invoicing, with weekly subtotals, a month total per task, and a "rounding added" transparency line.

```bash
export TOGGL_API_TOKEN=your-token

# A month's report, ready to paste into a client system (decimal-comma):
npx migrate-from-toggl report --start 2024-04-01 --end 2024-04-30 --format comma

# The same period as an invoice summary:
npx migrate-from-toggl invoice --start 2024-04-01 --end 2024-04-30

# A spreadsheet:
npx migrate-from-toggl report --csv --start 2024-01-01 --end 2024-12-31 > 2024.csv
```

Run any command with `--help` for its full option list.

## Why it's more than a CSV dump

Billing by hand gets these wrong; this tool gets them right:

- **Full history.** It uses Toggl's **Reports API**, so it pulls years of entries — not the ~3-month window the account timer view is limited to.
- **Sum-then-round, not round-then-sum.** Entries are summed per task per day *first*, then rounded — round-then-sum quietly overstates every total.
- **15-minute ceiling rounding** (configurable): 7 min → 15, 73 → 75, 213 → 225.
- **15-minute minimum billable**: any task touched in a day bills at least the minimum.
- **Task-per-day scope**: rounding is applied once per task per day, so a dozen short entries don't each round up.
- **ISO weeks**: weekly recaps run Monday–Sunday, so weekend work stays in the week it was done.
- **Defer tasks waiting on a PO** with `--exclude-task "Data Migration"` — pulled into a separate "deferred" section so nothing silently disappears.

## Runs on your machine, with your data

There's no account and no server. The tool talks only to Toggl's API, using the token you provide, from your own machine — your time data never passes through anyone else's service. Output files (`.txt`, `.csv`, `.json`) contain client-sensitive detail (task names, ticket IDs, descriptions); keep them out of version control.

## Archive everything (`--rec-export`)

```bash
npx migrate-from-toggl report --rec-export --start 2017-01-01 --end 2024-12-31 > my-toggl-history.json
```

Entry-level JSON — *not* pre-rounded — with a `hierarchy` summary of every client/project/task combination seen. It preserves everything needed to re-process later, and it's the exact format [REC](https://rec.work) imports, so today's export drops straight into REC's "Import from Toggl" with no re-pull.

## Options (report)

| Flag | Default | Notes |
|------|---------|-------|
| `--start YYYY-MM-DD` | first of current month | Period start |
| `--end YYYY-MM-DD` | today | Period end |
| `--format hmm\|dot\|comma` | `hmm` | Duration format (`comma` = `7,25` for European systems) |
| `--exclude-task <pattern>` | (none) | Defer tasks matching the substring; repeatable |
| `--workday` | off | Compact per-day output |
| `--csv` | off | Semicolon-separated CSV |
| `--raw` | off | Raw entries as JSON (no aggregation) |
| `--rec-export` | off | Lossless entry-level JSON archive |
| `--token <token>` | `TOGGL_API_TOKEN` | Inline token override |
| `--help`, `-h` | — | Show usage |

`invoice` takes `--start`, `--end`, `--format`, `--exclude-task`, and `--help`.

## Requirements

- **Node.js 20 or later** (uses built-in `fetch`, `parseArgs`, `node:test` — zero dependencies)
- **A Toggl API token** — [track.toggl.com/profile](https://track.toggl.com/profile)

## Run from source instead

```bash
git clone https://github.com/inetsp/migrate-from-toggl && cd migrate-from-toggl
export TOGGL_API_TOKEN=your-token
node bin/migrate-from-toggl.mjs report --start 2024-01-01 --end 2024-12-31
node --test test/*.test.mjs   # run the spec tests
```

## Powered by REC

This CLI is the aggregation-and-rounding engine of **[REC](https://rec.work)** — a modern, EU-sovereign time-tracking and billing platform where work is *recorded as you do it*, not reconstructed from memory. If you're leaving Toggl, REC is where this tool is taking you.

MIT licensed.
