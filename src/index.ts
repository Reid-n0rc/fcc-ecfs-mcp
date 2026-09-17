import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getFiling,
  getFilingSchema,
  rawRequest,
  rawRequestSchema,
  searchFilings,
  searchFilingsSchema,
  searchProceedings,
  searchProceedingsSchema,
} from "./tools.js";

// Load .env from the project root regardless of the process's cwd, so the
// server works whether launched via `npm run dev` or as an absolute-path
// MCP server command from a client config. Real environment variables
// (e.g. set by the MCP client) always take precedence.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: path.join(projectRoot, ".env") });

const server = new McpServer({
  name: "fcc-ecfs-mcp",
  version: "0.1.0",
});

function toToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toErrorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

server.registerTool(
  "ecfs_search_filings",
  {
    title: "Search ECFS filings",
    description:
      "Search filings submitted to the FCC's Electronic Comment Filing System (ECFS). " +
      "Filter by proceeding/docket number, filer name, submission type, and date received.",
    inputSchema: searchFilingsSchema.shape,
  },
  async (input) => {
    try {
      return toToolResult(await searchFilings(input));
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "ecfs_get_filing",
  {
    title: "Get an ECFS filing by ID",
    description: "Fetch a single ECFS filing by its submission ID.",
    inputSchema: getFilingSchema.shape,
  },
  async (input) => {
    try {
      return toToolResult(await getFiling(input));
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "ecfs_search_proceedings",
  {
    title: "Search ECFS proceedings",
    description:
      "Search proceedings (dockets) registered in the FCC ECFS system, e.g. by docket number.",
    inputSchema: searchProceedingsSchema.shape,
  },
  async (input) => {
    try {
      return toToolResult(await searchProceedings(input));
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "ecfs_raw_request",
  {
    title: "Raw ECFS API request",
    description:
      "Escape hatch for calling any ECFS public API path/query parameters not covered by the " +
      "other tools. The api_key is added automatically; do not include it yourself.",
    inputSchema: rawRequestSchema.shape,
  },
  async (input) => {
    try {
      return toToolResult(await rawRequest(input));
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error starting fcc-ecfs-mcp:", error);
  process.exit(1);
});
