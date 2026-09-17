import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ecfsGet, EcfsApiError, MissingApiKeyError, redactUrl } from "../src/ecfsClient.js";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("redactUrl", () => {
  it("replaces the api_key value but keeps the rest of the URL", () => {
    const url = "https://publicapi.fcc.gov/ecfs/filings?limit=5&api_key=super-secret-123";
    const redacted = redactUrl(url);
    expect(redacted).not.toContain("super-secret-123");
    expect(redacted).toContain("api_key=REDACTED");
    expect(redacted).toContain("limit=5");
  });

  it("is a no-op when there is no api_key param", () => {
    const url = "https://publicapi.fcc.gov/ecfs/filings?limit=5";
    expect(redactUrl(url)).toBe(url);
  });
});

describe("ecfsGet", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws MissingApiKeyError when ECFS_API_KEY is unset", async () => {
    delete process.env.ECFS_API_KEY;
    await expect(ecfsGet("/filings")).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("throws MissingApiKeyError when ECFS_API_KEY is blank", async () => {
    process.env.ECFS_API_KEY = "   ";
    await expect(ecfsGet("/filings")).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("trims surrounding whitespace from the API key before using it", async () => {
    process.env.ECFS_API_KEY = "  test-key-123\n";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ filing: [] }));

    await ecfsGet("/filings");

    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get("api_key")).toBe("test-key-123");
  });

  it("appends api_key and query params to the request URL", async () => {
    process.env.ECFS_API_KEY = "test-key-123";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ filing: [] }));

    await ecfsGet("/filings", { limit: 10, "proceedings.name": "17-108" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe("https://publicapi.fcc.gov/ecfs/filings");
    expect(calledUrl.searchParams.get("api_key")).toBe("test-key-123");
    expect(calledUrl.searchParams.get("limit")).toBe("10");
    expect(calledUrl.searchParams.get("proceedings.name")).toBe("17-108");
  });

  it("omits undefined query params", async () => {
    process.env.ECFS_API_KEY = "test-key-123";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ filing: [] }));

    await ecfsGet("/filings", { q: undefined, limit: 5 });

    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.has("q")).toBe(false);
    expect(calledUrl.searchParams.get("limit")).toBe("5");
  });

  it("returns parsed JSON on a 2xx response", async () => {
    process.env.ECFS_API_KEY = "test-key-123";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ filing: [{ id_submission: "abc123" }] }),
    );

    const result = await ecfsGet<{ filing: Array<{ id_submission: string }> }>("/filings");
    expect(result.filing[0].id_submission).toBe("abc123");
  });

  it("throws EcfsApiError with a redacted URL on a non-2xx response", async () => {
    process.env.ECFS_API_KEY = "leak-me-not";
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "nope" } }, 404),
    );

    await expect(ecfsGet("/filings/does-not-exist")).rejects.toMatchObject({
      name: "EcfsApiError",
      status: 404,
    });

    try {
      await ecfsGet("/filings/does-not-exist");
      expect.fail("expected ecfsGet to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EcfsApiError);
      const apiError = error as EcfsApiError;
      expect(apiError.message).not.toContain("leak-me-not");
      expect(apiError.message).toContain("REDACTED");
    }
  });

  it("wraps network failures without leaking the api key", async () => {
    process.env.ECFS_API_KEY = "leak-me-not-either";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    await expect(ecfsGet("/filings")).rejects.toThrow(/Network error/);
    try {
      await ecfsGet("/filings");
    } catch (error) {
      expect((error as Error).message).not.toContain("leak-me-not-either");
    }
  });

  it("redacts the api key when the response body echoes it back", async () => {
    process.env.ECFS_API_KEY = "leak-me-not-in-body";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        download_plan: {
          buckets: [
            {
              suggested_api_call: [
                "https://publicapi.fcc.gov/ecfs/filings?api_key=leak-me-not-in-body&limit=5",
              ],
            },
          ],
        },
      }),
    );

    const result = await ecfsGet<{
      download_plan: { buckets: Array<{ suggested_api_call: string[] }> };
    }>("/filings", { type: "downloadplan" });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("leak-me-not-in-body");
    expect(result.download_plan.buckets[0].suggested_api_call[0]).toContain("api_key=REDACTED");
  });

  it("handles a non-JSON error body gracefully", async () => {
    process.env.ECFS_API_KEY = "test-key-123";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(ecfsGet("/filings")).rejects.toMatchObject({ status: 500 });
  });
});
