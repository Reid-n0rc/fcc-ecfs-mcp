import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchMock = vi.hoisted(() => vi.fn());
vi.mock("playwright-core", () => ({ chromium: { launch: launchMock } }));

import {
  documentUrls,
  downloadDocument,
  filenameFromDisposition,
  isPdf,
  resolveDownloadDir,
  safeFilename,
} from "../src/download.js";

const PDF = Buffer.from("%PDF-1.4\nfake pdf body\n%%EOF");

/** A fake browser whose document page answers with the given PDF response. */
function fakeBrowser(opts: {
  viewerStatus?: number;
  pdfStatus?: number;
  body?: Buffer;
  headers?: Record<string, string>;
  noPdfResponse?: boolean;
}) {
  const newContext = vi.fn();
  const close = vi.fn();
  const pdfResponse = {
    url: () => "https://www.fcc.gov/ecfs/documents/6015544108/1",
    status: () => opts.pdfStatus ?? 200,
    headers: () =>
      opts.headers ?? {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="7020397485.pdf"',
      },
    body: async () => opts.body ?? PDF,
  };
  const page = {
    waitForResponse: vi.fn(async (predicate: (r: typeof pdfResponse) => boolean) => {
      if (opts.noPdfResponse || !predicate(pdfResponse)) throw new Error("Timeout");
      return pdfResponse;
    }),
    goto: vi.fn(async () => ({ status: () => opts.viewerStatus ?? 200 })),
  };
  newContext.mockResolvedValue({ newPage: async () => page });
  const browser = {
    newPage: async () => ({
      evaluate: async () =>
        "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 HeadlessChrome/154.0.0.0 Safari/537.36",
      close: async () => {},
    }),
    newContext,
    close,
  };
  launchMock.mockResolvedValue(browser);
  return { browser, page, newContext, close };
}

describe("download helpers", () => {
  it("builds the viewer URL and the PDF request path", () => {
    expect(documentUrls("6015544108", 2)).toEqual({
      viewerUrl: "https://www.fcc.gov/ecfs/document/6015544108/2",
      pdfPath: "/ecfs/documents/6015544108/2",
    });
  });

  it("resolves the download dir: override, then ECFS_DOWNLOAD_DIR, then default", () => {
    expect(resolveDownloadDir("/tmp/x", { ECFS_DOWNLOAD_DIR: "/tmp/y" })).toBe("/tmp/x");
    expect(resolveDownloadDir(undefined, { ECFS_DOWNLOAD_DIR: "/tmp/y" })).toBe("/tmp/y");
    expect(resolveDownloadDir(undefined, {})).toBe(path.join(os.homedir(), "Downloads", "ecfs"));
    expect(resolveDownloadDir(undefined, { ECFS_DOWNLOAD_DIR: "~/ecfs" })).toBe(
      path.join(os.homedir(), "ecfs"),
    );
  });

  it("treats an empty or unexpanded plugin setting as unset", () => {
    const fallback = path.join(os.homedir(), "Downloads", "ecfs");
    expect(resolveDownloadDir(undefined, { ECFS_DOWNLOAD_DIR: "  " })).toBe(fallback);
    expect(
      resolveDownloadDir(undefined, { ECFS_DOWNLOAD_DIR: "${user_config.download_dir}" }),
    ).toBe(fallback);
  });

  it("strips path parts and odd characters from filenames", () => {
    expect(safeFilename("../../etc/passwd", "f.pdf")).toBe("passwd");
    expect(safeFilename("..\\..\\evil.pdf", "f.pdf")).toBe("evil.pdf");
    expect(safeFilename("my file (1).pdf", "f.pdf")).toBe("my_file__1_.pdf");
    expect(safeFilename("..", "f.pdf")).toBe("f.pdf");
    expect(safeFilename(undefined, "f.pdf")).toBe("f.pdf");
  });

  it("reads the filename from Content-Disposition", () => {
    expect(filenameFromDisposition('inline; filename="7020397485.pdf"')).toBe("7020397485.pdf");
    expect(filenameFromDisposition("attachment; filename=a.pdf")).toBe("a.pdf");
    expect(filenameFromDisposition(undefined)).toBeUndefined();
  });

  it("recognizes PDFs by their magic bytes", () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(Buffer.from("<HTML><HEAD><TITLE>Access Denied"))).toBe(false);
  });
});

describe("downloadDocument", () => {
  let dir: string;

  beforeEach(() => {
    launchMock.mockReset();
    dir = mkdtempSync(path.join(os.tmpdir(), "ecfs-dl-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("saves the PDF the viewer page requests, named after the ECFS file", async () => {
    const { page, newContext, close } = fakeBrowser({});

    const res = await downloadDocument({ id_submission: "6015544108", output_dir: dir });

    expect(launchMock).toHaveBeenCalledWith({ channel: "chrome", headless: true });
    expect(newContext.mock.calls[0][0].userAgent).not.toContain("HeadlessChrome");
    expect(page.goto.mock.calls[0][0]).toBe("https://www.fcc.gov/ecfs/document/6015544108/1");
    expect(res.saved_path).toBe(path.join(dir, "6015544108_7020397485.pdf"));
    expect(res.byte_size).toBe(PDF.length);
    expect(readFileSync(res.saved_path)).toEqual(PDF);
    expect(close).toHaveBeenCalled();
  });

  it("falls back to {id}-{n}.pdf without a Content-Disposition filename", async () => {
    fakeBrowser({ headers: { "content-type": "application/pdf" } });

    const res = await downloadDocument({ id_submission: "6015544108", output_dir: dir });

    expect(res.filename).toBe("6015544108-1.pdf");
  });

  it("reuses an identical existing file and never overwrites a different one", async () => {
    fakeBrowser({});
    const first = await downloadDocument({ id_submission: "6015544108", output_dir: dir });
    const again = await downloadDocument({ id_submission: "6015544108", output_dir: dir });
    expect(again.saved_path).toBe(first.saved_path);

    writeFileSync(first.saved_path, "%PDF-different");
    const third = await downloadDocument({ id_submission: "6015544108", output_dir: dir });
    expect(third.filename).toBe("6015544108_7020397485-1.pdf");
    expect(readFileSync(first.saved_path, "utf-8")).toBe("%PDF-different");
  });

  it("rejects a response that isn't a PDF", async () => {
    const { close } = fakeBrowser({ body: Buffer.from("<HTML>Access Denied</HTML>") });

    await expect(
      downloadDocument({ id_submission: "6015544108", output_dir: dir }),
    ).rejects.toThrow(/Expected a PDF/);
    expect(readdirSync(dir)).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it("reports when the site refuses the document page", async () => {
    const { close } = fakeBrowser({ viewerStatus: 403 });

    await expect(
      downloadDocument({ id_submission: "6015544108", output_dir: dir }),
    ).rejects.toThrow(/HTTP 403/);
    expect(close).toHaveBeenCalled();
  });

  it("reports a missing document as a timeout with a hint", async () => {
    fakeBrowser({ noPdfResponse: true });

    await expect(
      downloadDocument({ id_submission: "6015544108", document_number: 9, output_dir: dir }),
    ).rejects.toThrow(/ecfs_search_documents/);
  });

  it("explains when Chrome can't be started", async () => {
    launchMock.mockRejectedValue(new Error("Chromium distribution 'chrome' is not found"));

    await expect(
      downloadDocument({ id_submission: "6015544108", output_dir: dir }),
    ).rejects.toThrow(/Install Google Chrome/);
  });
});
