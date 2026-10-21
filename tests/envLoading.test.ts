import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Launches the committed dist/ build as a real process, in throwaway copies laid out
// like a source checkout and like an npm install, to check where .env is read from and
// that stdout carries nothing but JSON-RPC. Copies, so the repo's own .env is never read.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "env-loading-test", version: "0" },
  },
});

let tmp: string;
let checkoutEntry: string;
let installedEntry: string;
let otherCwd: string;
let probe: string;

/** Lay out a package root: a copy of dist/, the repo's dependencies, and a planted .env. */
function makePackageRoot(root: string, marker: string): string {
  mkdirSync(root, { recursive: true });
  cpSync(path.join(repoRoot, "dist"), path.join(root, "dist"), { recursive: true });
  symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "dir");
  writeFileSync(path.join(root, ".env"), `MARKER=${marker}\nECFS_API_KEY=from-${marker}-env\n`);
  return path.join(root, "dist", "index.js");
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "fcc-ecfs-env-"));
  checkoutEntry = makePackageRoot(path.join(tmp, "checkout"), "checkout");
  installedEntry = makePackageRoot(
    path.join(tmp, "app", "node_modules", "fcc-ecfs-mcp"),
    "installed",
  );
  // The MCP client's working directory, with an unrelated .env that must never be read.
  otherCwd = path.join(tmp, "client-cwd");
  mkdirSync(otherCwd);
  writeFileSync(path.join(otherCwd, ".env"), "MARKER=cwd\nECFS_API_KEY=from-cwd-env\n");
  // Reports the env the server ended up with, on stderr, once it exits at stdin EOF.
  probe = path.join(tmp, "probe.mjs");
  writeFileSync(
    probe,
    "process.on('exit', () => process.stderr.write('PROBE ' + JSON.stringify(" +
      "{ MARKER: process.env.MARKER ?? null, ECFS_API_KEY: process.env.ECFS_API_KEY ?? null }) + '\\n'));\n",
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Run `node <entry>` from the client's cwd, send `initialize`, close stdin. */
function launch(entry: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === "ECFS_API_KEY" || key === "MARKER") continue;
    if (key.startsWith("DOTENV_")) continue;
    env[key] = value;
  }
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(probe).href, entry], {
    cwd: otherCwd,
    env: { ...env, ...extraEnv },
    input: `${INIT}\n`,
    encoding: "utf8",
    timeout: 15_000,
  });
  const probeLine = result.stderr.split("\n").find((line) => line.startsWith("PROBE "));
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    loaded: probeLine ? JSON.parse(probeLine.slice("PROBE ".length)) : undefined,
  };
}

/** stdout must be nothing but JSON-RPC messages, one per line, including the reply. */
function expectPureJsonRpc(stdout: string) {
  const lines = stdout.split("\n").filter((line) => line !== "");
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(() => JSON.parse(line), line).not.toThrow();
  expect(JSON.parse(lines[0])).toMatchObject({
    id: 1,
    result: { serverInfo: { name: "fcc-ecfs-mcp" } },
  });
}

function expectNoDotenvOutput(stdout: string, stderr: string) {
  for (const stream of [stdout, stderr]) {
    expect(stream).not.toContain("injected env");
    expect(stream).not.toContain("┆");
  }
}

const DOTENV_NOISE = {
  DOTENV_DEBUG: "1",
  DOTENV_CONFIG_DEBUG: "1",
  DOTENV_QUIET: "false",
  DOTENV_CONFIG_QUIET: "false",
  DOTENV_PATH: ".env", // the client's cwd .env, which must stay unread
};

describe(".env loading in a launched server", () => {
  it("loads the checkout's .env when launched as `node <checkout>/dist/index.js` from another cwd with no env block", () => {
    const run = launch(checkoutEntry);

    expect(run.loaded).toEqual({ MARKER: "checkout", ECFS_API_KEY: "from-checkout-env" });
    expectPureJsonRpc(run.stdout);
    expectNoDotenvOutput(run.stdout, run.stderr);
  });

  it("keeps stdout pure JSON-RPC with DOTENV_DEBUG set", () => {
    const run = launch(checkoutEntry, DOTENV_NOISE);

    expect(run.loaded).toEqual({ MARKER: "checkout", ECFS_API_KEY: "from-checkout-env" });
    expectPureJsonRpc(run.stdout);
    expectNoDotenvOutput(run.stdout, run.stderr);
  });

  it("lets the client's ECFS_API_KEY win over .env even with DOTENV_OVERRIDE set", () => {
    const run = launch(checkoutEntry, {
      ...DOTENV_NOISE,
      DOTENV_OVERRIDE: "1",
      DOTENV_CONFIG_OVERRIDE: "1",
      ECFS_API_KEY: "from-client",
    });

    expect(run.loaded).toEqual({ MARKER: "checkout", ECFS_API_KEY: "from-client" });
    expectPureJsonRpc(run.stdout);
    expectNoDotenvOutput(run.stdout, run.stderr);
  });

  it("reads no .env at all for a copy installed under node_modules", () => {
    const run = launch(installedEntry, { ...DOTENV_NOISE, DOTENV_OVERRIDE: "1" });

    expect(run.loaded).toEqual({ MARKER: null, ECFS_API_KEY: null });
    expectPureJsonRpc(run.stdout);
    expectNoDotenvOutput(run.stdout, run.stderr);
  });
});
