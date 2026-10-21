import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchMock = vi.hoisted(() => vi.fn());
vi.mock("playwright-core", () => ({ chromium: { launch: launchMock } }));

import {
  documentUrls,
  downloadDocument,
  downloadRoot,
  filenameFromDisposition,
  isPdf,
  isWithin,
  pdfFilename,
  resolveDownloadDir,
  safeFilename,
} from "../src/download.js";

const PDF = Buffer.from("%PDF-1.4\nfake pdf body\n%%EOF");
const OUTSIDE = /must be inside the download folder/;

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

describe("download root", () => {
  it("is ECFS_DOWNLOAD_DIR, else ~/Downloads/ecfs", () => {
    expect(downloadRoot({ ECFS_DOWNLOAD_DIR: "/tmp/y" })).toBe(path.resolve("/tmp/y"));
    expect(downloadRoot({})).toBe(path.join(os.homedir(), "Downloads", "ecfs"));
    expect(downloadRoot({ ECFS_DOWNLOAD_DIR: "~/ecfs" })).toBe(path.join(os.homedir(), "ecfs"));
    expect(downloadRoot({}, "/h", path.posix)).toBe("/h/Downloads/ecfs");
  });

  it("treats an empty or unexpanded plugin setting as unset", () => {
    const fallback = path.join(os.homedir(), "Downloads", "ecfs");
    expect(downloadRoot({ ECFS_DOWNLOAD_DIR: "  " })).toBe(fallback);
    expect(downloadRoot({ ECFS_DOWNLOAD_DIR: "${user_config.download_dir}" })).toBe(fallback);
  });
});

describe("isWithin", () => {
  it("matches .. segment-wise and rejects prefix siblings", () => {
    expect(isWithin("/r/ecfs", "/r/ecfs", path.posix)).toBe(true);
    expect(isWithin("/r/ecfs", "/r/ecfs/a/b", path.posix)).toBe(true);
    expect(isWithin("/r/ecfs", "/r/ecfs/..foo", path.posix)).toBe(true);
    expect(isWithin("/r/ecfs", "/r/ecfs2", path.posix)).toBe(false);
    expect(isWithin("/r/ecfs", "/r", path.posix)).toBe(false);
    expect(isWithin("/r/ecfs", "/etc", path.posix)).toBe(false);
  });
});

describe("resolveDownloadDir (posix)", () => {
  const home = "/h";
  const root = "/h/Downloads/ecfs";
  const resolve = (override: string | undefined, env: NodeJS.ProcessEnv = {}) =>
    resolveDownloadDir(override, env, home, path.posix);

  it("uses the default root with no override", () => {
    expect(resolve(undefined)).toEqual({ root, dir: root });
    expect(resolve("  ")).toEqual({ root, dir: root });
  });

  it("uses ECFS_DOWNLOAD_DIR as the root when set", () => {
    expect(resolve(undefined, { ECFS_DOWNLOAD_DIR: "/data/ecfs" })).toEqual({
      root: "/data/ecfs",
      dir: "/data/ecfs",
    });
    expect(resolve("sub", { ECFS_DOWNLOAD_DIR: "/data/ecfs" }).dir).toBe("/data/ecfs/sub");
    expect(() => resolve(root, { ECFS_DOWNLOAD_DIR: "/data/ecfs" })).toThrow(OUTSIDE);
  });

  it("resolves relative subfolders against the root", () => {
    expect(resolve("wt-09-209").dir).toBe(`${root}/wt-09-209`);
    expect(resolve("a/b").dir).toBe(`${root}/a/b`);
    expect(resolve("a/..").dir).toBe(root);
    expect(resolve("..foo").dir).toBe(`${root}/..foo`);
  });

  it("rejects traversal out of the root", () => {
    for (const bad of ["..", "../x", "a/../../x", "a/../.."]) {
      expect(() => resolve(bad), bad).toThrow(OUTSIDE);
    }
  });

  it("rejects absolute paths outside the root, including a prefix sibling", () => {
    for (const bad of ["/etc", "/tmp/x", `${root}2`, "/h/Downloads"]) {
      expect(() => resolve(bad), bad).toThrow(OUTSIDE);
    }
  });

  it("accepts absolute paths inside the root", () => {
    expect(resolve(`${root}/sub`).dir).toBe(`${root}/sub`);
    expect(resolve(root).dir).toBe(root);
  });

  it("expands ~ and confines the result", () => {
    expect(resolve("~/Downloads/ecfs/sub").dir).toBe(`${root}/sub`);
    for (const bad of ["~", "~/Library/LaunchAgents", "~/.config/x"]) {
      expect(() => resolve(bad), bad).toThrow(OUTSIDE);
    }
  });

  it("names the root in the error", () => {
    expect(() => resolve("/etc")).toThrow(root);
  });
});

describe("resolveDownloadDir (win32)", () => {
  const home = "C:\\Users\\r";
  const root = "C:\\Users\\r\\Downloads\\ecfs";
  const resolve = (override: string) => resolveDownloadDir(override, {}, home, path.win32);

  it("accepts subfolders, case differences and ~\\ paths inside the root", () => {
    expect(resolve("sub").dir).toBe(`${root}\\sub`);
    expect(resolve("C:\\Users\\R\\downloads\\ECFS\\sub").root).toBe(root);
    expect(resolve("~\\Downloads\\ecfs\\sub").dir).toBe(`${root}\\sub`);
  });

  it("rejects other drives, UNC paths, rooted paths and traversal", () => {
    for (const bad of [
      "D:\\x",
      "\\\\srv\\share\\x",
      "\\Windows",
      "..\\x",
      "sub\\..\\..\\x",
      "~\\AppData\\Roaming\\x",
    ]) {
      expect(() => resolve(bad), bad).toThrow(OUTSIDE);
    }
  });
});

describe("pdfFilename", () => {
  const name = (disposition: string | undefined) => pdfFilename("6015544108", 1, disposition);

  it("keeps the usual ECFS name unchanged", () => {
    expect(name('inline; filename="7020397485.pdf"')).toBe("6015544108_7020397485.pdf");
    expect(name('inline; filename="Comments.PDF"')).toBe("6015544108_Comments.pdf");
  });

  it("always ends in .pdf, with no other dot", () => {
    for (const ext of ["pth", "plist", "sh", "command", "desktop", "lnk", "pth.pdf"]) {
      const result = name(`attachment; filename="x.${ext}"`);
      expect(result, ext).toMatch(/^6015544108_x_[a-z_]+\.pdf$/);
      expect(result.split(".")).toHaveLength(2);
    }
    expect(name('attachment; filename="evil.pth"')).toBe("6015544108_evil_pth.pdf");
  });

  it("falls back to {id}-{n}.pdf without a usable name", () => {
    expect(name(undefined)).toBe("6015544108-1.pdf");
    expect(name('inline; filename=".."')).toBe("6015544108-1.pdf");
    expect(name('inline; filename="..."')).toBe("6015544108-1.pdf");
    expect(name('inline; filename=".pdf"')).toBe("6015544108_pdf.pdf");
  });

  it("truncates long names", () => {
    const result = name(`attachment; filename="${"a".repeat(300)}.pdf"`);
    expect(result.endsWith(".pdf")).toBe(true);
    expect(Buffer.byteLength(result)).toBeLessThan(255);
  });
});

describe("downloadDocument", () => {
  let tmp: string;
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    launchMock.mockReset();
    // realpath: on macOS the temp dir is itself behind a symlink (/var -> /private/var),
    // and saved paths are reported as real paths.
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ecfs-dl-")));
    dir = path.join(tmp, "root");
    mkdirSync(dir);
    env = { ECFS_DOWNLOAD_DIR: dir };
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("saves the PDF the viewer page requests, named after the ECFS file", async () => {
    const { page, newContext, close } = fakeBrowser({});

    const res = await downloadDocument({ id_submission: "6015544108" }, env);

    expect(launchMock).toHaveBeenCalledWith({ channel: "chrome", headless: true });
    expect(newContext.mock.calls[0][0].userAgent).not.toContain("HeadlessChrome");
    expect(page.goto.mock.calls[0][0]).toBe("https://www.fcc.gov/ecfs/document/6015544108/1");
    expect(res.saved_path).toBe(path.join(dir, "6015544108_7020397485.pdf"));
    expect(res.byte_size).toBe(PDF.length);
    expect(readFileSync(res.saved_path)).toEqual(PDF);
    expect(close).toHaveBeenCalled();
  });

  it("creates the download root if it doesn't exist", async () => {
    fakeBrowser({});
    const root = path.join(tmp, "new", "root");

    const res = await downloadDocument(
      { id_submission: "6015544108" },
      { ECFS_DOWNLOAD_DIR: root },
    );

    expect(res.saved_path).toBe(path.join(root, "6015544108_7020397485.pdf"));
  });

  it("saves into a subfolder of the root", async () => {
    fakeBrowser({});

    const res = await downloadDocument(
      { id_submission: "6015544108", output_dir: "docket/a" },
      env,
    );

    expect(res.saved_path).toBe(path.join(dir, "docket", "a", "6015544108_7020397485.pdf"));
  });

  it("falls back to {id}-{n}.pdf without a Content-Disposition filename", async () => {
    fakeBrowser({ headers: { "content-type": "application/pdf" } });

    const res = await downloadDocument({ id_submission: "6015544108" }, env);

    expect(res.filename).toBe("6015544108-1.pdf");
  });

  it("forces a .pdf extension whatever name the server suggests", async () => {
    fakeBrowser({
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="evil.pth"',
      },
    });

    const res = await downloadDocument({ id_submission: "6015544108" }, env);

    expect(res.saved_path).toBe(path.join(dir, "6015544108_evil_pth.pdf"));
    expect(readdirSync(dir)).toEqual(["6015544108_evil_pth.pdf"]);
  });

  it("reuses an identical existing file and never overwrites a different one", async () => {
    fakeBrowser({});
    const first = await downloadDocument({ id_submission: "6015544108" }, env);
    const again = await downloadDocument({ id_submission: "6015544108" }, env);
    expect(again.saved_path).toBe(first.saved_path);

    writeFileSync(first.saved_path, "%PDF-different");
    const third = await downloadDocument({ id_submission: "6015544108" }, env);
    expect(third.filename).toBe("6015544108_7020397485-1.pdf");
    expect(readFileSync(first.saved_path, "utf-8")).toBe("%PDF-different");
  });

  it("rejects an output_dir outside the root before starting Chrome", async () => {
    fakeBrowser({});
    const outside = path.join(tmp, "outside");

    for (const output_dir of [outside, "../outside", os.tmpdir()]) {
      await expect(
        downloadDocument({ id_submission: "6015544108", output_dir }, env),
        output_dir,
      ).rejects.toThrow(OUTSIDE);
    }
    expect(launchMock).not.toHaveBeenCalled();
    expect(existsSync(outside)).toBe(false);
  });

  it("rejects a symlink inside the root that points outside it", async () => {
    fakeBrowser({});
    const elsewhere = path.join(tmp, "elsewhere");
    mkdirSync(elsewhere);
    try {
      symlinkSync(elsewhere, path.join(dir, "link"), "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return; // Windows without rights
      throw error;
    }

    for (const output_dir of ["link", "link/new/deeper"]) {
      await expect(
        downloadDocument({ id_submission: "6015544108", output_dir }, env),
        output_dir,
      ).rejects.toThrow(OUTSIDE);
    }
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("allows a download root that is itself a symlink", async () => {
    fakeBrowser({});
    const link = path.join(tmp, "root-link");
    try {
      symlinkSync(dir, link, "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    const res = await downloadDocument(
      { id_submission: "6015544108", output_dir: "sub" },
      { ECFS_DOWNLOAD_DIR: link },
    );

    expect(res.saved_path).toBe(path.join(dir, "sub", "6015544108_7020397485.pdf"));
    expect(readFileSync(res.saved_path)).toEqual(PDF);
  });

  it("rejects a response that isn't a PDF, whatever the headers say", async () => {
    const { close } = fakeBrowser({
      body: Buffer.from("<HTML>Access Denied</HTML>"),
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="x.pdf"',
      },
    });

    await expect(
      downloadDocument({ id_submission: "6015544108", output_dir: "sub" }, env),
    ).rejects.toThrow(/Expected a PDF/);
    expect(readdirSync(dir)).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it("reports when the site refuses the document page", async () => {
    const { close } = fakeBrowser({ viewerStatus: 403 });

    await expect(downloadDocument({ id_submission: "6015544108" }, env)).rejects.toThrow(
      /HTTP 403/,
    );
    expect(close).toHaveBeenCalled();
  });

  it("reports a missing document as a timeout with a hint", async () => {
    fakeBrowser({ noPdfResponse: true });

    await expect(
      downloadDocument({ id_submission: "6015544108", document_number: 9 }, env),
    ).rejects.toThrow(/ecfs_search_documents/);
  });

  it("explains when Chrome can't be started", async () => {
    launchMock.mockRejectedValue(new Error("Chromium distribution 'chrome' is not found"));

    await expect(downloadDocument({ id_submission: "6015544108" }, env)).rejects.toThrow(
      /Install Google Chrome/,
    );
  });
});
