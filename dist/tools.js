import { z } from "zod";
import { ecfsGet } from "./ecfsClient.js";
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
function buildFilingFilterParams(input) {
    return {
        q: input.q,
        "proceedings.name": input.proceedings_name,
        "filers.name": input.filers_name,
        "submissiontype.description": input.submissiontype_description,
        "date_received[since]": input.date_received_since,
        "date_received[until]": input.date_received_until,
        sort: input.sort,
    };
}
export async function searchFilings(input) {
    const params = {
        ...buildFilingFilterParams(input),
        limit: input.limit,
        offset: input.offset,
    };
    return ecfsGet("/filings", params);
}
export const getDownloadPlanSchema = z.object({
    q: searchFilingsSchema.shape.q,
    proceedings_name: searchFilingsSchema.shape.proceedings_name,
    filers_name: searchFilingsSchema.shape.filers_name,
    submissiontype_description: searchFilingsSchema.shape.submissiontype_description,
    date_received_since: searchFilingsSchema.shape.date_received_since,
    date_received_until: searchFilingsSchema.shape.date_received_until,
    sort: searchFilingsSchema.shape.sort,
});
/**
 * A large docket's filing count can exceed what offset/limit paging can
 * reliably enumerate (results can duplicate or drop entries). The download
 * plan instead buckets the same query by date_submission range, each with a
 * "suggested_api_call" that's safe to run to exhaustively page the docket.
 */
export async function getDownloadPlan(input) {
    const params = {
        ...buildFilingFilterParams(input),
        type: "downloadplan",
    };
    return ecfsGet("/filings", params);
}
export const getFilingSchema = z.object({
    id_submission: z.string().min(1).describe("The ECFS submission ID of the filing to fetch."),
});
export async function getFiling(input) {
    return ecfsGet(`/filing/${encodeURIComponent(input.id_submission)}`);
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
export async function searchProceedings(input) {
    const params = {
        name: input.name,
        limit: input.limit,
        offset: input.offset,
    };
    return ecfsGet("/proceedings", params);
}
export const searchDocumentsSchema = z.object({
    id_submission: z
        .string()
        .min(1)
        .describe("Submission ID(s) of the filing(s) to list documents for. Comma-separate multiple IDs."),
});
export async function searchDocuments(input) {
    return ecfsGet("/documents", { id_submission: input.id_submission });
}
export const listInboxesSchema = z.object({});
export async function listInboxes(_input) {
    return ecfsGet("/inbox");
}
export const rawRequestSchema = z.object({
    path: z
        .string()
        .min(1)
        .describe("ECFS API path to call, relative to https://publicapi.fcc.gov/ecfs (e.g. '/filings', '/filings/{id}', '/proceedings'). Use this for endpoints or parameters not covered by the other tools."),
    params: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Query parameters to send, excluding api_key (added automatically)."),
});
export async function rawRequest(input) {
    if (input.path.includes("api_key") || "api_key" in (input.params ?? {})) {
        throw new Error("Do not pass api_key manually; it is added automatically.");
    }
    return ecfsGet(input.path, (input.params ?? {}));
}
