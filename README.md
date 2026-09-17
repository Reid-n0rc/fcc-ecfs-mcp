# fcc-ecfs-mcp

An [MCP](https://modelcontextprotocol.io) server for the FCC's [Electronic Comment
Filing System (ECFS) public API](https://www.fcc.gov/ecfs/help/public_api). Lets an
MCP client (Claude Desktop, Claude Code, etc.) search filings and proceedings, fetch a
specific filing, and issue raw requests against endpoints not otherwise covered.

## Tools

| Tool | Description |
| --- | --- |
| `ecfs_search_filings` | Search filings by free text, proceeding/docket number, filer name, submission type, or date received. |
| `ecfs_get_filing` | Fetch a single filing by its submission ID. |
| `ecfs_search_proceedings` | Search proceedings (dockets), e.g. by docket number. |
| `ecfs_raw_request` | Escape hatch: call any ECFS path/query params not covered above. `api_key` is added automatically. |

## Setup

1. Get a free API key at <https://www.fcc.gov/ecfs/help/public_api>.
2. Install dependencies and build:

   ```bash
   npm install
   npm run build
   ```

3. Provide the key via the `ECFS_API_KEY` environment variable — **never commit it or
   pass it as a tool argument**. For local development, copy `.env.example` to `.env`
   (git-ignored) and fill it in.

### Claude Desktop / Claude Code config

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

Prefer sourcing `ECFS_API_KEY` from your OS keychain or a secrets manager (e.g. 1Password,
`gpg`-encrypted dotfiles) rather than pasting it into a config file where possible.

## Slash commands

`.claude/commands/` ships project-scoped Claude Code slash commands that wrap the
tools above (auto-discovered by Claude Code — no separate registration step needed):

| Command | Description |
| --- | --- |
| `/fcc-ecfs <query>` | General dispatcher — picks the right ECFS tool for the request. |
| `/fcc-search-filings <args>` | Search filings by docket, filer, type, date, or text. |
| `/fcc-search-proceedings <docket>` | Look up a proceeding/docket by number or name. |
| `/fcc-get-filing <submission id>` | Fetch a single filing by its submission ID. |

## Development

```bash
npm run dev        # run the server directly with tsx
npm test           # run the unit test suite (vitest)
npm run typecheck  # type-check without emitting
```

## Security notes

- The API key is read only from `process.env.ECFS_API_KEY` — it is never accepted as a
  tool input, so it cannot be echoed back into a model's context or transcript.
- Error messages and thrown errors redact the `api_key` query parameter before they are
  ever logged or returned to a client.
- `.env` is git-ignored; only `.env.example` (no real key) is committed.

## License

MIT
