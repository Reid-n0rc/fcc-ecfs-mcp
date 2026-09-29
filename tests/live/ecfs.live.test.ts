import { beforeAll, describe, expect, it } from "vitest";
import { MissingApiKeyError } from "../../src/ecfsClient.js";
import {
  getDownloadPlan,
  getFiling,
  listInboxes,
  rawRequest,
  searchDocuments,
  searchFilings,
  searchProceedings,
} from "../../src/tools.js";

// Hits the real ECFS API. Run with `npm run test:live`; excluded from `npm test`.
// Uses a small, stable docket so queries stay fast (huge dockets like 17-108
// can take minutes to answer unsorted filing searches).
const DOCKET = "24-186";

const apiKey = process.env.ECFS_API_KEY?.trim() ?? "";

/** Fails if the configured key appears anywhere in a response. */
function expectNoKeyLeak(body: unknown) {
  expect(JSON.stringify(body)).not.toContain(apiKey);
}

describe("ECFS live API", () => {
  let idSubmission: string;

  beforeAll(async () => {
    if (!apiKey) throw new MissingApiKeyError();
    const res: any = await searchFilings({
      proceedings_name: DOCKET,
      sort: "date_disseminated,DESC",
      limit: 1,
    });
    idSubmission = res.filing[0].id_submission;
  });

  it("searchFilings returns filings for the docket", async () => {
    const res: any = await searchFilings({
      proceedings_name: DOCKET,
      sort: "date_disseminated,DESC",
      limit: 2,
    });
    expect(res.filing.length).toBeGreaterThan(0);
    expect(res.filing.length).toBeLessThanOrEqual(2);
    for (const filing of res.filing) {
      expect(filing.proceedings.map((p: any) => p.name)).toContain(DOCKET);
    }
    expectNoKeyLeak(res);
  });

  it("getFiling returns the requested submission", async () => {
    const res: any = await getFiling({ id_submission: idSubmission });
    expect(res.id_submission).toBe(idSubmission);
    expect(Array.isArray(res.documents)).toBe(true);
    expectNoKeyLeak(res);
  });

  it("searchProceedings finds the docket by name", async () => {
    const res: any = await searchProceedings({ name: DOCKET, limit: 1 });
    expect(res.proceeding[0].name).toBe(DOCKET);
    expectNoKeyLeak(res);
  });

  it("searchDocuments lists documents for a submission", async () => {
    const res: any = await searchDocuments({ id_submission: idSubmission });
    expect(res).toBeTruthy();
    expectNoKeyLeak(res);
  });

  it("getDownloadPlan returns buckets with the api_key redacted", async () => {
    const res: any = await getDownloadPlan({ proceedings_name: DOCKET });
    const buckets = res.download_plan.buckets;
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets[0].suggested_api_call[0]).toContain("api_key=REDACTED");
    expectNoKeyLeak(res);
  });

  it("listInboxes responds", async () => {
    const res = await listInboxes({});
    expect(res).toBeDefined();
    expectNoKeyLeak(res);
  });

  it("rawRequest reaches an arbitrary endpoint", async () => {
    const res: any = await rawRequest({ path: "/proceedings", params: { name: DOCKET, limit: 1 } });
    expect(res.proceeding[0].name).toBe(DOCKET);
    expectNoKeyLeak(res);
  });
});
