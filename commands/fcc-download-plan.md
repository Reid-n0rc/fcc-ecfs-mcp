---
description: Get a download plan for exhaustively paging a large FCC ECFS docket without duplicate/missing filings.
---

Call `mcp__fcc-ecfs__ecfs_get_download_plan` for this request: $ARGUMENTS

Map a docket number to `proceedings_name`, a filer/commenter name to `filers_name`, and
keyword text to `q`, same as `/fcc-search-filings`.

Present the date-range buckets as a concise list (date range, filing count) rather than
raw JSON, and note that each bucket's `suggested_api_call` can be run via
`ecfs_search_filings` (or `ecfs_raw_request`) to fetch that slice of the docket in full.
