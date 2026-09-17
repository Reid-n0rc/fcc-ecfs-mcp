import { z } from "zod";
import { ecfsGet, type QueryParams } from "./ecfsClient.js";

export const searchFilingsSchema = z.object({
  q: z
    .string()
    .optional()
    .describe("Free-text search across filing content (e.g. commenter name, keywords)."),
  proceedings_name: z
    .string()
    .optional()
    .describe("Docket / proceeding number to filter by, e.g. '17-108'."),
  filers_name: z.string().optional().describe("Filter by the filer's/commenter's name."),
  submissiontype_description: z
    .string()
    .optional()
    .describe("Filter by submission type, e.g. 'COMMENT', 'REPLY'."),
  date_received_since: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD); only return filings received on or after this date."),
  date_received_until: z
    .string()
    .optional()
    .describe("ISO date (YYYY-MM-DD); only return filings received on or before this date."),
  sort: z
    .string()
    .optional()
    .describe("Sort field and direction, e.g. 'date_disseminated,DESC'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max results to return (API max is 100). Defaults to 25."),
  offset: z.number().int().min(0).optional().describe("Pagination offset. Defaults to 0."),
});
export type SearchFilingsInput = z.infer<typeof searchFilingsSchema>;

export async function searchFilings(input: SearchFilingsInput) {
  const params: QueryParams = {
    q: input.q,
    "proceedings.name": input.proceedings_name,
    "filers.name": input.filers_name,
    "submissiontype.description": input.submissiontype_description,
    "date_received[since]": input.date_received_since,
    "date_received[until]": input.date_received_until,
    sort: input.sort,
    limit: input.limit,
    offset: input.offset,
  };
  return ecfsGet("/filings", params);
}

export const getFilingSchema = z.object({
  id_submission: z.string().min(1).describe("The ECFS submission ID of the filing to fetch."),
});
export type GetFilingInput = z.infer<typeof getFilingSchema>;

export async function getFiling(input: GetFilingInput) {
  return ecfsGet(`/filings/${encodeURIComponent(input.id_submission)}`);
}

export const searchProceedingsSchema = z.object({
  name: z
    .string()
    .optional()
    .describe("Docket / proceeding number to filter by, e.g. '17-108'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max results to return. Defaults to 25."),
  offset: z.number().int().min(0).optional().describe("Pagination offset. Defaults to 0."),
});
export type SearchProceedingsInput = z.infer<typeof searchProceedingsSchema>;

export async function searchProceedings(input: SearchProceedingsInput) {
  const params: QueryParams = {
    name: input.name,
    limit: input.limit,
    offset: input.offset,
  };
  return ecfsGet("/proceedings", params);
}

export const rawRequestSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "ECFS API path to call, relative to https://publicapi.fcc.gov/ecfs (e.g. '/filings', '/filings/{id}', '/proceedings'). Use this for endpoints or parameters not covered by the other tools.",
    ),
  params: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Query parameters to send, excluding api_key (added automatically)."),
});
export type RawRequestInput = z.infer<typeof rawRequestSchema>;

export async function rawRequest(input: RawRequestInput) {
  if (input.path.includes("api_key")) {
    throw new Error("Do not pass api_key manually; it is added automatically.");
  }
  return ecfsGet(input.path, (input.params ?? {}) as QueryParams);
}
