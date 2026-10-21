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
   - `npm run test:coverage` runs the unit tests with coverage, writing
     `coverage/lcov.info` and printing a text summary. The live suites (`test:live`,
     `test:download`) aren't part of coverage.
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

### Claude Code Action (owner only)

The owner can hand an approved issue to the
[Claude Code Action](https://github.com/anthropics/claude-code-action)
(`.github/workflows/claude.yml`), which implements it and opens the pull request as
`claude[bot]`. Because the PR isn't authored by the owner, CODEOWNERS requests the
owner's review and he can approve and merge it normally.

- **Triggering it.** Only `Reid-n0rc` can, and only on issues he wrote. Assign the
  issue, make sure it has the `software plan approved` label, then add the `agent-go`
  label. A comment containing `@claude` on such an issue also starts a run. Labels or
  mentions from anyone else are ignored, and only the owner's comments are passed to
  Claude. To hand over an issue someone else opened, restate it as a new issue written
  by the owner (the approval label can't stop its author from editing it later).
- **What it does.** It branches from `main` as `claude/issue-<n>-<slug>`, runs
  `npm run typecheck`, `npm test`, `npm run test:coverage` and `npm run build`, commits
  `dist/` if `src/` changed, and opens one PR into `main` whose body starts with
  `Closes #<n>`. It never merges, approves, labels, tags or releases, and it can't edit
  `.github/` (the Claude App has no `workflows` permission), `package.json` or
  `package-lock.json`. It doesn't run the live tests; CI does that on its PR.
- **Reviewing its PR.** Review it like any other. To ask for changes, comment `@claude
  <what to change>` on the PR or on a line of its diff; it pushes to the same branch,
  CI reruns and any earlier approval is dismissed. When it's right, approve and merge.
  `@claude` only works on PRs opened by `claude[bot]`, never on a person's PR.
- **Stopping it.** Remove `agent-go` (a queued run re-checks the labels and stops), or
  run `gh workflow disable claude.yml`. Close any unwanted `claude/*` PR.
- **When to use a local session instead.** Changes to `.github/workflows/`, work that
  needs the live ECFS API during development, or anything the owner wants to drive
  interactively.

The committed `.claude/settings.json` holds permission rules shared by the Action and
local Claude Code sessions. It denies anything that would get around the owner's approval
gate or rewrite history: Bash commands naming the `software plan approved` or `agent-go`
labels, `gh label`, force pushes, tag pushes, pushes to `main`, `gh pr review`,
`gh release`, `gh secret`, `gh auth token` and reading `.env`. Sensitive operations that
local sessions sometimes need ask first: `gh pr merge` (including `--admin`),
`gh issue edit`, `gh pr edit`, any `gh api` call, GraphQL and `gh alias`. Do label changes yourself in a
terminal. These rules are defence in depth, not a security boundary. The real controls are the workflow's own
tool lists, the Claude App's limited permissions and the `main` rulesets. Personal rules
go in `.claude/settings.local.json`, which is ignored; they can add to these rules but
can't lift a deny.

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

Codecov also comments on each pull request with its coverage change and posts
`codecov/project` and `codecov/patch` statuses. These are informational and don't block
merging; `ci-ok` is the required check.
