---
description: Look something up in the FCC's Electronic Comment Filing System (ECFS) — proceedings, filings, or a specific filing by ID.
---

Use the `mcp__fcc-ecfs__*` tools to answer this ECFS request: $ARGUMENTS

Pick the right tool based on what's being asked:
- A docket/proceeding number or name lookup → `ecfs_search_proceedings`
- Filings by docket, filer name, submission type, date range, or free-text search → `ecfs_search_filings`
- A specific filing by its submission ID → `ecfs_get_filing`
- Anything not covered by the above → `ecfs_raw_request`

Summarize the results clearly rather than dumping raw JSON.
