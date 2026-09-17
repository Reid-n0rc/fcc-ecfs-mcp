import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getDownloadPlan,
  getDownloadPlanSchema,
  getFiling,
  getFilingSchema,
  listInboxes,
  listInboxesSchema,
  rawRequest,
  rawRequestSchema,
  searchDocuments,
  searchDocumentsSchema,
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
  version: "0.3.0",
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
  "ecfs_get_download_plan",
  {
    title: "Get an ECFS download plan for a filings query",
    description:
      "Get a download plan for a filings search — the same filters as ecfs_search_filings, " +
      "but instead of a page of results, returns date_submission-range buckets each with a " +
      "suggested_api_call safe to run to exhaustively page a large docket. Use this before " +
      "ecfs_search_filings for dockets with thousands of filings (e.g. a heavily-commented " +
      "NPRM): plain offset/limit paging over a large result set can return duplicate or " +
      "missing filings, which the download plan's date-bucketed queries avoid.",
    inputSchema: getDownloadPlanSchema.shape,
  },
  async (input) => {
    try {
      return toToolResult(await getDownloadPlan(input));
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "ecfs_search_documents",
  {
    title: "List documents for an ECFS filing",
    description:
      "List the documents (attachments) associated with one or more ECFS filings, by " +
      "submission ID. Returns document metadata (filename, page count, byte size, OCR " +
      "status, and its viewer location) — not the document's file contents.",
    inputSchema: searchDocumentsSchema.shape,
  },
  async (input) => {
    try {
      return toToolResult(await searchDocuments(input));
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "ecfs_list_inboxes",
  {
    title: "List ECFS non-docketed filing inboxes",
    description: "List the available inboxes for non-docketed filings in ECFS.",
    inputSchema: listInboxesSchema.shape,
  },
  async (input) => {
    try {
      return toToolResult(await listInboxes(input));
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
