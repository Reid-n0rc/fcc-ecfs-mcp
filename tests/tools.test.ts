import { beforeEach, describe, expect, it, vi } from "vitest";

const ecfsGetMock = vi.hoisted(() => vi.fn());

vi.mock("../src/ecfsClient.js", async () => {
  const actual = await vi.importActual<typeof import("../src/ecfsClient.js")>(
    "../src/ecfsClient.js",
  );
  return { ...actual, ecfsGet: ecfsGetMock };
});

import {
  getFiling,
  listInboxes,
  rawRequest,
  searchDocuments,
  searchFilings,
  searchProceedings,
} from "../src/tools.js";

describe("searchFilings", () => {
  beforeEach(() => ecfsGetMock.mockReset());

  it("maps friendly input fields to ECFS query parameter names", async () => {
    ecfsGetMock.mockResolvedValue({ filing: [] });

    await searchFilings({
      q: "net neutrality",
      proceedings_name: "17-108",
      filers_name: "Jane Doe",
      submissiontype_description: "COMMENT",
      date_received_since: "2024-01-01",
      date_received_until: "2024-02-01",
      sort: "date_disseminated,DESC",
      limit: 10,
      offset: 20,
    });

    expect(ecfsGetMock).toHaveBeenCalledWith("/filings", {
      q: "net neutrality",
      "proceedings.name": "17-108",
      "filers.name": "Jane Doe",
      "submissiontype.description": "COMMENT",
      "date_received[since]": "2024-01-01",
      "date_received[until]": "2024-02-01",
      sort: "date_disseminated,DESC",
      limit: 10,
      offset: 20,
    });
  });

  it("passes through undefined for omitted optional fields", async () => {
    ecfsGetMock.mockResolvedValue({ filing: [] });

    await searchFilings({});

    expect(ecfsGetMock).toHaveBeenCalledWith("/filings", {
      q: undefined,
      "proceedings.name": undefined,
      "filers.name": undefined,
      "submissiontype.description": undefined,
      "date_received[since]": undefined,
      "date_received[until]": undefined,
      sort: undefined,
      limit: undefined,
      offset: undefined,
    });
  });
});

describe("getFiling", () => {
  beforeEach(() => ecfsGetMock.mockReset());

  it("requests the filing by ID with URL-encoding", async () => {
    ecfsGetMock.mockResolvedValue({ id_submission: "abc 123" });

    await getFiling({ id_submission: "abc 123" });

    expect(ecfsGetMock).toHaveBeenCalledWith("/filing/abc%20123");
  });
});

describe("searchDocuments", () => {
  beforeEach(() => ecfsGetMock.mockReset());

  it("requests documents by submission ID", async () => {
    ecfsGetMock.mockResolvedValue([]);

    await searchDocuments({ id_submission: "6016165687" });

    expect(ecfsGetMock).toHaveBeenCalledWith("/documents", {
      id_submission: "6016165687",
    });
  });

  it("passes through comma-separated IDs verbatim", async () => {
    ecfsGetMock.mockResolvedValue([]);

    await searchDocuments({ id_submission: "6016165687,6017788670" });

    expect(ecfsGetMock).toHaveBeenCalledWith("/documents", {
      id_submission: "6016165687,6017788670",
    });
  });
});

describe("listInboxes", () => {
  beforeEach(() => ecfsGetMock.mockReset());

  it("requests the inbox list with no params", async () => {
    ecfsGetMock.mockResolvedValue([]);

    await listInboxes({});

    expect(ecfsGetMock).toHaveBeenCalledWith("/inbox");
  });
});

describe("searchProceedings", () => {
  beforeEach(() => ecfsGetMock.mockReset());

  it("forwards name/limit/offset", async () => {
    ecfsGetMock.mockResolvedValue({ proceedings: [] });

    await searchProceedings({ name: "17-108", limit: 5, offset: 0 });

    expect(ecfsGetMock).toHaveBeenCalledWith("/proceedings", {
      name: "17-108",
      limit: 5,
      offset: 0,
    });
  });
});

describe("rawRequest", () => {
  beforeEach(() => ecfsGetMock.mockReset());

  it("forwards path and params verbatim", async () => {
    ecfsGetMock.mockResolvedValue({ ok: true });

    await rawRequest({ path: "/filings", params: { limit: 3 } });

    expect(ecfsGetMock).toHaveBeenCalledWith("/filings", { limit: 3 });
  });

  it("defaults params to an empty object", async () => {
    ecfsGetMock.mockResolvedValue({ ok: true });

    await rawRequest({ path: "/proceedings" });

    expect(ecfsGetMock).toHaveBeenCalledWith("/proceedings", {});
  });

  it("rejects a path containing api_key to avoid double/overridden keys", async () => {
    await expect(rawRequest({ path: "/filings?api_key=x" })).rejects.toThrow(
      /Do not pass api_key/,
    );
    expect(ecfsGetMock).not.toHaveBeenCalled();
  });
});
