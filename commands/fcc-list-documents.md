---
description: List the documents/attachments for one or more FCC ECFS filings by submission ID.
---

Call `mcp__fcc-ecfs__ecfs_search_documents` with `id_submission` set to: $ARGUMENTS

(Comma-separate multiple submission IDs.) Present each document's filename, description,
page count, and byte size as a concise list — not raw JSON. Note that this only returns
document metadata, not the document's file contents.
