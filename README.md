# fcc-ecfs-mcp

An [MCP](https://modelcontextprotocol.io) server for the FCC's [Electronic Comment
Filing System (ECFS) public API](https://www.fcc.gov/ecfs/help/public_api). Implements
every endpoint in ECFS's public OpenAPI spec — filings, a single filing, proceedings,
a filing's documents, and non-docketed filing inboxes — plus an escape hatch for
anything else. Lets an MCP client (Claude Desktop, Claude Code, etc.) search and fetch
across all of them.

## Tools

| Tool | ECFS endpoint | Description |
| --- | --- | --- |
| `ecfs_search_filings` | `GET /filings` | Search filings by free text, proceeding/docket number, filer name, submission type, or date received. |
| `ecfs_get_filing` | `GET /filing/{id}` | Fetch a single filing by its submission ID. |
| `ecfs_search_proceedings` | `GET /proceedings` | Search proceedings (dockets), e.g. by docket number. |
| `ecfs_get_download_plan` | `GET /filings?type=downloadplan` | Get date-bucketed queries safe for exhaustively paging a large docket (e.g. a heavily-commented NPRM) — plain offset/limit paging over a big result set can return duplicate or missing filings. |
| `ecfs_search_documents` | `GET /documents` | List a filing's document/attachment metadata (filename, page count, byte size, OCR status) by submission ID. Does not return file contents — ECFS's public API is metadata-only; the actual PDF is served from the (bot-protected) ECFS website. |
| `ecfs_list_inboxes` | `GET /inbox` | List the available inboxes for non-docketed filings. |
| `ecfs_raw_request` | any | Escape hatch: call any ECFS path/query params not covered above. `api_key` is added automatically. |

## Setup

### Option A: Claude Code plugin (recommended)

This repo is a Claude Code plugin — it bundles the MCP server and the slash commands
below into a single install, and works from any directory (no manual config editing,
no `cd`-ing into this repo first).

1. Get a free API key at <https://www.fcc.gov/ecfs/help/public_api>.
2. Install the plugin directly from this repo:

   ```
   /plugin install Reid-n0rc/fcc-ecfs-mcp
   ```

   Claude Code will prompt for your FCC ECFS API key (stored securely, not pasted into
   a config file) and register both the `fcc-ecfs` MCP server and the `/fcc-ecfs:*`
   slash commands automatically.

### Option B: Manual MCP server config

For non-Claude-Code MCP clients (Claude Desktop, etc.), or if you'd rather manage the
server yourself:

1. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

2. Provide the key via the `ECFS_API_KEY` environment variable — **never commit it or
   pass it as a tool argument**. For local development, copy `.env.example` to `.env`
   (git-ignored) and fill it in.

3. Add to your client's MCP config:

   ```json
   {
     "mcpServers": {
       "fcc-ecfs": {
         "command": "node",
         "args": ["/absolute/path/to/fcc-ecfs-mcp/dist/index.js"],
         "env": {
           "ECFS_API_KEY": "your-api-key-here"
         }
       }
     }
   }
   ```

   Prefer sourcing `ECFS_API_KEY` from your OS keychain or a secrets manager (e.g.
   1Password, `gpg`-encrypted dotfiles) rather than pasting it into a config file
   where possible.

## Slash commands

`commands/` ships Claude Code slash commands that wrap the tools above. Installed as
a plugin, they're namespaced under `fcc-ecfs`:

| Command | Description |
| --- | --- |
| `/fcc-ecfs:fcc-ecfs <query>` | General dispatcher — picks the right ECFS tool for the request. |
| `/fcc-ecfs:fcc-search-filings <args>` | Search filings by docket, filer, type, date, or text. |
| `/fcc-ecfs:fcc-search-proceedings <docket>` | Look up a proceeding/docket by number or name. |
| `/fcc-ecfs:fcc-get-filing <submission id>` | Fetch a single filing by its submission ID. |
| `/fcc-ecfs:fcc-list-documents <submission id(s)>` | List document/attachment metadata for one or more filings. |
| `/fcc-ecfs:fcc-download-plan <args>` | Get a download plan for exhaustively paging a large docket. |

## Development

```bash
npm run dev        # run the server directly with tsx
npm test           # run the unit test suite (vitest)
npm run typecheck  # type-check without emitting
```

To test the plugin locally before publishing a change, rebuild and point Claude Code at
the working tree:

```bash
npm run build
claude --plugin-dir .
```

Note that the plugin loader never runs `npm run build` on install — it only runs
`npm ci` to fetch dependencies. `dist/` must be committed and up to date before pushing.

## Known limitation: document/PDF content isn't fetchable

The ECFS public API (this server's only data source) is **metadata-only**. No endpoint
returns a document's file bytes or extracted text — not `/filings`, not `/filing/{id}`,
and not `/documents` (see `ecfs_search_documents`'s `Document` schema: it has fields like
`file_name`, `page_count`, `byte_size`, `ocr_flag`, and a `location` URL, but no text/content
field).

That `location` field (and the `documents[].src` field on a `Filing`) points at
`https://www.fcc.gov/ecfs/document/{id_submission}/{n}` — the ECFS *website*, a separate
system from the public API, sitting behind Akamai bot protection. Direct HTTP requests to
it — via `curl`, this server, or any other non-browser HTTP client — return `403
Forbidden` regardless of headers (user-agent, `Referer`, `Accept-Language`, etc. make no
difference; the block operates below the HTTP layer, on the TLS/network fingerprint).

This project will not attempt to work around that protection — not via TLS-fingerprint
impersonation, proxying, or other anti-bot-evasion tooling, even though it's technically
possible and ECFS's underlying content is public. If you need a document's actual text:

- Open the `location`/`src` URL in a real browser (a human doing this is exactly the
  traffic Akamai lets through).
- Automate a real, visible browser session (e.g. Claude Code's Chrome extension) rather
  than a bare HTTP client — the request then carries a browser's genuine fingerprint
  instead of one constructed to fake it.
- Download the PDF yourself and read/summarize it locally.

## Security notes

- The API key is read only from `process.env.ECFS_API_KEY` — it is never accepted as a
  tool input, so it cannot be echoed back into a model's context or transcript.
- Error messages and thrown errors redact the `api_key` query parameter before they are
  ever logged or returned to a client. Response *bodies* are also scrubbed of the literal
  key value before being returned — some ECFS response types (e.g. `type=downloadplan`)
  echo the key back verbatim in generated URLs, so URL-only redaction isn't sufficient.
- `.env` is git-ignored; only `.env.example` (no real key) is committed.

## License

MIT
