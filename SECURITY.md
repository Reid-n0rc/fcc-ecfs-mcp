# Security Policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | Yes       |
| < 0.3   | No        |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately through GitHub's
[private vulnerability reporting](https://github.com/Reid-n0rc/fcc-ecfs-mcp/security/advisories/new)
(Security tab → "Report a vulnerability"). Include the affected version, steps to
reproduce, and the impact you observed.

You should get an acknowledgement within a week. Confirmed issues are fixed in a new
release and disclosed through a GitHub security advisory, with credit if you want it.

## Scope

In scope — anything in this repository, for example:

- The ECFS API key leaking into tool output, error messages, logs, or transcripts
  (including bypasses of the response-body and URL redaction).
- Tool inputs (e.g. `ecfs_raw_request`) that can send the key to a host other than
  the FCC ECFS API, or otherwise escape the intended request scope.
- Vulnerable dependencies that are reachable from this server.

Out of scope:

- The FCC ECFS service itself — report those to the FCC.
