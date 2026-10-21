import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads the committed files, so it also catches a stale dist/ that wasn't rebuilt.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("CLI entrypoint", () => {
  it.each(["src/index.ts", pkg.bin["fcc-ecfs-mcp"]])("%s starts with a node shebang", (file) => {
    const firstLine = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n", 1)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });
});
