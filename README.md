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
| `ecfs_search_documents` | `GET /documents` | List a filing's document/attachment metadata (filename, page count, byte size, OCR status) by submission ID. Does not return file contents — ECFS's public API is metadata-only. |
| `ecfs_download_document` | ECFS website (headless Chrome) | Download a filing's document (PDF) and save it to disk; returns the saved path, size, and SHA-256. See [Downloading documents](#downloading-documents). |
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
   a config file) and an optional download folder for `ecfs_download_document`
   (default `~/Downloads/ecfs`), and register both the `fcc-ecfs` MCP server and the
   `/fcc-ecfs:*` slash commands automatically.
3. To download documents, have [Google Chrome](https://www.google.com/chrome/) installed.

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
           "ECFS_API_KEY": "your-api-key-here",
           "ECFS_DOWNLOAD_DIR": "~/Downloads/ecfs"
         }
       }
     }
   }
   ```

   Prefer sourcing `ECFS_API_KEY` from your OS keychain or a secrets manager (e.g.
   1Password, `gpg`-encrypted dotfiles) rather than pasting it into a config file
   where possible. `ECFS_DOWNLOAD_DIR` is optional (default `~/Downloads/ecfs`).

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
| `/fcc-ecfs:fcc-download-document <id, URL, or description>` | Download a filing's document (PDF) to the download folder. |

## Development

```bash
npm run dev        # run the server directly with tsx
npm test           # run the unit test suite (vitest)
npm run test:live  # run live tests against the real ECFS API (needs ECFS_API_KEY)
npm run test:download  # download a real document via headless Chrome (local only)
npm run typecheck  # type-check without emitting
```

CI (`.github/workflows/ci.yml`) runs the unit tests and the live tests on every push to
`main` and every PR, plus weekly and on manual dispatch; docs-only changes skip the test
jobs. Live tests use the `ECFS_API_KEY` secret (`gh secret set ECFS_API_KEY`, and again
with `--app dependabot` for Dependabot PRs). Fork PRs can't read secrets, so they skip the
live tests.

Changes to `main` go through a pull request that needs an approving review from the
repo owner (`.github/CODEOWNERS`) and a passing `ci-ok` check, which rolls up every CI job.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

To test the plugin locally before publishing a change, rebuild and point Claude Code at
the working tree:

```bash
npm run build
claude --plugin-dir .
```

Note that the plugin loader never runs `npm run build` on install — it only runs
`npm ci` to fetch dependencies. `dist/` must be committed and up to date before pushing.

## Downloading documents

The ECFS public API is **metadata-only**: no endpoint returns a document's file bytes or
text. A document's `location` (or a filing's `documents[].src`) points at
`https://www.fcc.gov/ecfs/document/{id_submission}/{n}` on the ECFS *website*, which
refuses non-browser HTTP clients such as `curl` with `403 Forbidden`.

`ecfs_download_document` therefore opens that page in headless Google Chrome (via
`playwright-core`, using your installed Chrome — no bundled browser download) and saves
the PDF the page loads. Headless Chrome is presented under its regular Chrome user agent,
since the site refuses the default `HeadlessChrome` one. No window is shown.

- Files are saved to `ECFS_DOWNLOAD_DIR` (plugin setting "Download folder"; default
  `~/Downloads/ecfs`), named `{id_submission}_{ECFS filename}`. The model can pass
  `output_dir` when you ask for a specific location.
- Re-downloading an identical file reuses the existing copy; a different file with the
  same name gets a numeric suffix rather than overwriting.
- Each download takes a few seconds. The tool fetches one document per call; it isn't
  meant for bulk-downloading whole dockets.

## Security notes

- The API key is read only from `process.env.ECFS_API_KEY` — it is never accepted as a
  tool input, so it cannot be echoed back into a model's context or transcript.
- Error messages and thrown errors redact the `api_key` query parameter before they are
  ever logged or returned to a client. Response *bodies* are also scrubbed of the literal
  key value before being returned — some ECFS response types (e.g. `type=downloadplan`)
  echo the key back verbatim in generated URLs, so URL-only redaction isn't sufficient.
- `.env` is git-ignored; only `.env.example` (no real key) is committed.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

MIT
