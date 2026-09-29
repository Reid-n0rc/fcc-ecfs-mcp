---
description: Download a document (PDF) from an FCC ECFS filing and save it locally.
---

Download the ECFS document described here: $ARGUMENTS

This may be a submission ID (optionally with a document number), an
`https://www.fcc.gov/ecfs/document/{id_submission}/{n}` URL, or a description of a filing.
If it's a description, find the filing first with `mcp__fcc-ecfs__ecfs_search_filings`, and
if the filing has several documents, list them with `mcp__fcc-ecfs__ecfs_search_documents`
and pick the right one.

Then call `mcp__fcc-ecfs__ecfs_download_document` with `id_submission` and `document_number`
(the `{n}` from the URL; 1 if there's only one document). Report the saved file path, the
file size, and the document's ECFS link.
