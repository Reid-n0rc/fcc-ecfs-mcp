import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const toolMocks = vi.hoisted(() => ({
  searchFilings: vi.fn(),
  getFiling: vi.fn(),
  searchProceedings: vi.fn(),
  getDownloadPlan: vi.fn(),
  searchDocuments: vi.fn(),
  listInboxes: vi.fn(),
  rawRequest: vi.fn(),
  downloadDocument: vi.fn(),
}));

const loadDotenvMock = vi.hoisted(() => vi.fn());
const stdioTransports = vi.hoisted(() => [] as unknown[]);

vi.mock("../src/tools.js", async () => {
  const actual = await vi.importActual<typeof import("../src/tools.js")>("../src/tools.js");
  return {
    ...actual,
    searchFilings: toolMocks.searchFilings,
    getFiling: toolMocks.getFiling,
    searchProceedings: toolMocks.searchProceedings,
    getDownloadPlan: toolMocks.getDownloadPlan,
    searchDocuments: toolMocks.searchDocuments,
    listInboxes: toolMocks.listInboxes,
    rawRequest: toolMocks.rawRequest,
  };
});

vi.mock("../src/download.js", async () => {
  const actual = await vi.importActual<typeof import("../src/download.js")>("../src/download.js");
  return { ...actual, downloadDocument: toolMocks.downloadDocument };
});

vi.mock("dotenv", () => ({ config: loadDotenvMock }));

// Stand-in for the stdio transport so main() can be exercised without touching the
// test process's real stdin/stdout.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
    constructor() {
      stdioTransports.push(this);
    }
    async start() {}
    async send() {}
    async close() {
      this.onclose?.();
    }
  },
}));

import { createServer, envFilePath, main } from "../src/index.js";

// Snapshot side effects of the import itself, before any test resets the mocks.
const importSideEffects = {
  dotenvCalls: loadDotenvMock.mock.calls.length,
  stdioTransports: stdioTransports.length,
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Each tool name, the mocked implementation it should dispatch to, and a valid input.
const TOOL_CASES = [
  { name: "ecfs_search_filings", impl: toolMocks.searchFilings, args: { q: "net neutrality" } },
  { name: "ecfs_get_filing", impl: toolMocks.getFiling, args: { id_submission: "123" } },
  {
    name: "ecfs_search_proceedings",
    impl: toolMocks.searchProceedings,
    args: { name: "17-108" },
  },
  {
    name: "ecfs_get_download_plan",
    impl: toolMocks.getDownloadPlan,
    args: { proceedings_name: "17-108" },
  },
  {
    name: "ecfs_search_documents",
    impl: toolMocks.searchDocuments,
    args: { id_submission: "123" },
  },
  {
    name: "ecfs_download_document",
    impl: toolMocks.downloadDocument,
    args: { id_submission: "123", document_number: 1 },
  },
  { name: "ecfs_list_inboxes", impl: toolMocks.listInboxes, args: {} },
  { name: "ecfs_raw_request", impl: toolMocks.rawRequest, args: { path: "/filings" } },
] as const;

async function connectClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "index-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("createServer", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    for (const mock of Object.values(toolMocks)) mock.mockReset();
    ({ client, server } = await connectClient());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("identifies itself as fcc-ecfs-mcp", () => {
    expect(client.getServerVersion()).toMatchObject({ name: "fcc-ecfs-mcp", version: "0.4.0" });
  });

  it("registers every ECFS tool with a title, description and input schema", async () => {
    const { tools } = await client.listTools();

    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(TOOL_CASES.map((c) => c.name)));
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it.each(TOOL_CASES)("$name returns the implementation's result as JSON text", async (c) => {
    const data = { tool: c.name, ok: true };
    c.impl.mockResolvedValue(data);

    const result = await client.callTool({ name: c.name, arguments: c.args });

    expect(c.impl).toHaveBeenCalledTimes(1);
    expect(c.impl.mock.calls[0][0]).toMatchObject(c.args);
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(data, null, 2) }]);
  });

  it.each(TOOL_CASES)("$name reports a thrown Error as an MCP tool error", async (c) => {
    c.impl.mockRejectedValue(new Error(`${c.name} failed`));

    const result = await client.callTool({ name: c.name, arguments: c.args });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: `${c.name} failed` }]);
  });

  it("stringifies non-Error rejections", async () => {
    toolMocks.getFiling.mockRejectedValue("plain string failure");

    const result = await client.callTool({
      name: "ecfs_get_filing",
      arguments: { id_submission: "123" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "plain string failure" }]);
  });

  it("rejects input that fails the tool's schema without calling the implementation", async () => {
    const result = await client.callTool({ name: "ecfs_get_filing", arguments: {} });

    expect(result.isError).toBe(true);
    expect(toolMocks.getFiling).not.toHaveBeenCalled();
  });
});

describe("main", () => {
  beforeEach(() => {
    loadDotenvMock.mockReset();
    stdioTransports.length = 0;
  });

  it("does not start the server when imported", () => {
    expect(importSideEffects).toEqual({ dotenvCalls: 0, stdioTransports: 0 });
  });

  it("loads .env from the project root and connects over stdio", async () => {
    await main();

    expect(loadDotenvMock).toHaveBeenCalledTimes(1);
    // Every option explicit, so DOTENV_* variables in the environment can't turn on
    // stdout debug output or let the file override env set by the MCP client.
    expect(loadDotenvMock).toHaveBeenCalledWith({
      path: path.join(projectRoot, ".env"),
      quiet: true,
      debug: false,
      override: false,
      encoding: "utf8",
    });
    expect(stdioTransports).toHaveLength(1);
    const transport = stdioTransports[0] as { onmessage?: unknown; close(): Promise<void> };
    expect(transport.onmessage).toBeTypeOf("function");
    await transport.close();
  });
});

describe("envFilePath", () => {
  const tmp = path.resolve("/tmp/envfilepath-test");
  const moduleUrl = (...segments: string[]) => pathToFileURL(path.join(tmp, ...segments)).href;

  it("uses the .env at the root of a source checkout", () => {
    expect(envFilePath(moduleUrl("checkout", "dist", "index.js"))).toBe(
      path.join(tmp, "checkout", ".env"),
    );
  });

  it("skips .env for an npm install under node_modules", () => {
    expect(
      envFilePath(moduleUrl("app", "node_modules", "fcc-ecfs-mcp", "dist", "index.js")),
    ).toBeUndefined();
  });

  it("skips .env for an npx install in the npm cache", () => {
    expect(
      envFilePath(
        moduleUrl("cache", "_npx", "abc123", "node_modules", "fcc-ecfs-mcp", "dist", "index.js"),
      ),
    ).toBeUndefined();
  });

  it("matches node_modules as a whole path segment, not a substring", () => {
    expect(envFilePath(moduleUrl("my_node_modules_fork", "dist", "index.js"))).toBe(
      path.join(tmp, "my_node_modules_fork", ".env"),
    );
  });

  it("defaults to this module's own project root", () => {
    expect(envFilePath()).toBe(path.join(projectRoot, ".env"));
  });
});
