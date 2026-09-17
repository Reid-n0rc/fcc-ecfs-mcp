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

## Security notes

- The API key is read only from `process.env.ECFS_API_KEY` — it is never accepted as a
  tool input, so it cannot be echoed back into a model's context or transcript.
- Error messages and thrown errors redact the `api_key` query parameter before they are
  ever logged or returned to a client.
- `.env` is git-ignored; only `.env.example` (no real key) is committed.

## License

MIT
