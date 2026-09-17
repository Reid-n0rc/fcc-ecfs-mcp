import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commandsDir = path.join(projectRoot, "commands");

const KNOWN_TOOLS = [
  "ecfs_search_filings",
  "ecfs_get_filing",
  "ecfs_search_proceedings",
  "ecfs_search_documents",
  "ecfs_list_inboxes",
  "ecfs_raw_request",
];

const EXPECTED_COMMANDS = [
  "fcc-ecfs.md",
  "fcc-search-filings.md",
  "fcc-search-proceedings.md",
  "fcc-get-filing.md",
  "fcc-list-documents.md",
];

function parseFrontmatter(content: string): { description?: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { body: content };
  const [, frontmatter, body] = match;
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  return { description: descMatch?.[1]?.trim(), body };
}

describe("slash commands", () => {
  it("only ships the expected command files", () => {
    const files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
    expect(new Set(files)).toEqual(new Set(EXPECTED_COMMANDS));
  });

  it.each(EXPECTED_COMMANDS)("%s has a non-empty frontmatter description", (file) => {
    const content = readFileSync(path.join(commandsDir, file), "utf-8");
    const { description } = parseFrontmatter(content);
    expect(description).toBeTruthy();
  });

  it.each(EXPECTED_COMMANDS)("%s only references real ECFS tool names", (file) => {
    const content = readFileSync(path.join(commandsDir, file), "utf-8");
    const stripped = content.replaceAll("mcp__fcc-ecfs__", "");
    const mentioned = [...stripped.matchAll(/\becfs_[a-z_]+/g)].map((m) => m[0]);
    expect(mentioned.length).toBeGreaterThan(0);
    for (const name of mentioned) {
      expect(KNOWN_TOOLS).toContain(name);
    }
  });

  it.each(EXPECTED_COMMANDS)("%s uses the $ARGUMENTS placeholder", (file) => {
    const content = readFileSync(path.join(commandsDir, file), "utf-8");
    expect(content).toContain("$ARGUMENTS");
  });
});
