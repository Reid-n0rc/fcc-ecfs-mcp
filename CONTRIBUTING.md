# Contributing

Thanks for helping improve the FCC ECFS MCP server. By taking part in this project you
agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

Open an issue using the bug report or feature request template. Please never include
your ECFS API key; replace it with `REDACTED` in any output you paste.

Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md),
not in a public issue.

## Development setup

You need Node.js 22.12 or newer and a free ECFS API key from
<https://www.fcc.gov/ecfs/help/public_api>.

```bash
npm ci
cp .env.example .env   # then set ECFS_API_KEY in .env
npm run dev            # run the server directly with tsx
```

To try your changes in Claude Code, rebuild and load the working tree as a plugin:

```bash
npm run build
claude --plugin-dir .
```

## Making a change

1. Create a branch from `main`.
2. Make your change, with tests:
   - Unit tests live in `tests/` and run with `npm test`. They must not touch the network.
   - Live tests against the real ECFS API live in `tests/live/` and run with
     `npm run test:live`. Add or update one when you change how the server calls ECFS.
3. Run the checks locally:
   ```bash
   npm run typecheck
   npm test
   npm run test:live   # needs ECFS_API_KEY
   ```
4. If you changed anything in `src/`, run `npm run build` and commit the updated
   `dist/`. The plugin loader never builds on install, so `dist/` must be committed and
   up to date.
5. Update the README and the slash commands in `commands/` if a tool's inputs or
   behavior changed.
6. Open a pull request and fill in the template.

## Guidelines

- **Keep the API key out of everything.** The key is read only from
  `process.env.ECFS_API_KEY`. Never accept it as a tool input, and make sure it can't
  appear in tool output, errors, or logs. The live tests fail if the key shows up in a
  response.
- **Match the existing style.** Tool input schemas use zod with a `.describe()` on every
  field, since those descriptions are what the model sees.

## Review and merging

Every pull request needs:

- a passing `ci-ok` check, which covers the typecheck, unit tests, build, and live tests
  (fork PRs skip the live tests because they can't read the repository's secrets), and
- an approving review from the repository owner (see `.github/CODEOWNERS`).

The maintainer may run the live tests on a fork PR's changes before merging.
