import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const ECFS_ORIGIN = "https://www.fcc.gov";
const DEFAULT_DOWNLOAD_DIR = path.join("~", "Downloads", "ecfs");
const DOWNLOAD_TIMEOUT_MS = 60_000;

export const downloadDocumentSchema = z.object({
  id_submission: z
    .string()
    .regex(/^\d+$/, "id_submission must be the numeric ECFS submission ID")
    .describe("The ECFS submission ID of the filing the document belongs to."),
  document_number: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based position of the document within the filing — the {n} in its " +
        "https://www.fcc.gov/ecfs/document/{id_submission}/{n} location URL. Defaults to 1.",
    ),
  output_dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Directory to save the file in. Omit to use the server's configured download " +
        "directory (ECFS_DOWNLOAD_DIR); only set this when the user asks for a specific place.",
    ),
});
export type DownloadDocumentInput = z.infer<typeof downloadDocumentSchema>;

export class DocumentDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentDownloadError";
  }
}

/** The ECFS website viewer page, and the PDF request that page makes. */
export function documentUrls(idSubmission: string, documentNumber: number) {
  return {
    viewerUrl: `${ECFS_ORIGIN}/ecfs/document/${idSubmission}/${documentNumber}`,
    pdfPath: `/ecfs/documents/${idSubmission}/${documentNumber}`,
  };
}

function expandHome(dir: string): string {
  if (dir === "~") return os.homedir();
  if (dir.startsWith("~/") || dir.startsWith("~\\")) return path.join(os.homedir(), dir.slice(2));
  return dir;
}

/**
 * Where to save downloads: an explicit override, else ECFS_DOWNLOAD_DIR, else
 * ~/Downloads/ecfs. An unset plugin userConfig value can arrive as an empty or
 * unexpanded "${...}" string, so both count as unset.
 */
export function resolveDownloadDir(
  override: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.ECFS_DOWNLOAD_DIR?.trim();
  const usable = configured && !configured.includes("${") ? configured : undefined;
  return path.resolve(expandHome(override?.trim() || usable || DEFAULT_DOWNLOAD_DIR));
}

/** A filename safe to join onto the download dir: no path parts, no odd characters. */
export function safeFilename(name: string | undefined, fallback: string): string {
  const base = path.basename((name ?? "").replace(/\\/g, "/"));
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned && cleaned !== "_" ? cleaned : fallback;
}

/** Pulls `filename` out of a Content-Disposition header, if present. */
export function filenameFromDisposition(header: string | undefined): string | undefined {
  return header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
}

export function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

/**
 * Loads the ECFS viewer page in headless Chrome and captures the PDF the page
 * requests. Plain HTTP clients are refused by the site's bot protection, so the
 * document has to come through a real browser.
 */
async function fetchPdfViaBrowser(viewerUrl: string, pdfPath: string) {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new DocumentDownloadError(
      "playwright-core is not installed; run `npm ci` in the fcc-ecfs-mcp directory.",
    );
  }

  let browser: import("playwright-core").Browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (cause) {
    throw new DocumentDownloadError(
      "Couldn't start Google Chrome, which ecfs_download_document uses to fetch documents. " +
        `Install Google Chrome and try again. (${cause instanceof Error ? cause.message.split("\n")[0] : cause})`,
    );
  }

  try {
    // Headless Chrome announces itself as "HeadlessChrome", which the ECFS site
    // refuses; present the same browser under its regular Chrome user agent.
    const probe = await browser.newPage();
    const userAgent = (await probe.evaluate(() => navigator.userAgent)).replace(
      "HeadlessChrome/",
      "Chrome/",
    );
    await probe.close();

    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    const pdfResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === pdfPath,
      { timeout: DOWNLOAD_TIMEOUT_MS },
    );
    // Don't leave an unhandled rejection behind if navigation fails first.
    pdfResponse.catch(() => {});

    const viewer = await page.goto(viewerUrl, {
      waitUntil: "domcontentloaded",
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    if (viewer && viewer.status() >= 400) {
      throw new DocumentDownloadError(
        `The ECFS website refused the document page (HTTP ${viewer.status()}): ${viewerUrl}`,
      );
    }

    let response: import("playwright-core").Response;
    try {
      response = await pdfResponse;
    } catch {
      throw new DocumentDownloadError(
        `Timed out waiting for the document from ${viewerUrl}. Check that the submission ID ` +
          "and document number exist (ecfs_search_documents lists a filing's documents).",
      );
    }
    if (response.status() !== 200) {
      throw new DocumentDownloadError(
        `The ECFS website returned HTTP ${response.status()} for ${viewerUrl}.`,
      );
    }

    return {
      body: await response.body(),
      contentType: response.headers()["content-type"],
      disposition: response.headers()["content-disposition"],
    };
  } finally {
    await browser.close();
  }
}

export async function downloadDocument(input: DownloadDocumentInput) {
  const documentNumber = input.document_number ?? 1;
  const { viewerUrl, pdfPath } = documentUrls(input.id_submission, documentNumber);

  const { body, contentType, disposition } = await fetchPdfViaBrowser(viewerUrl, pdfPath);
  if (!isPdf(body)) {
    throw new DocumentDownloadError(
      `Expected a PDF from ${viewerUrl} but got ${contentType ?? "an unknown content type"}.`,
    );
  }

  const fallback = `${input.id_submission}-${documentNumber}.pdf`;
  const ecfsName = safeFilename(filenameFromDisposition(disposition), fallback);
  const filename = ecfsName === fallback ? fallback : `${input.id_submission}_${ecfsName}`;
  const dir = resolveDownloadDir(input.output_dir);
  await mkdir(dir, { recursive: true });

  const sha256 = createHash("sha256").update(body).digest("hex");
  const savedPath = await writeWithoutClobbering(dir, filename, body, sha256);

  return {
    saved_path: savedPath,
    filename: path.basename(savedPath),
    byte_size: body.length,
    sha256,
    content_type: contentType ?? "application/pdf",
    source_url: viewerUrl,
  };
}

/**
 * Writes `bytes` as `filename` in `dir`. Re-downloading an identical file reuses
 * the existing copy; a different file with the same name gets a numeric suffix
 * instead of overwriting it.
 */
async function writeWithoutClobbering(
  dir: string,
  filename: string,
  bytes: Uint8Array,
  sha256: string,
): Promise<string> {
  const { name, ext } = path.parse(filename);
  for (let i = 0; i < 1000; i++) {
    const candidate = path.join(dir, i === 0 ? filename : `${name}-${i}${ext}`);
    try {
      await writeFile(candidate, bytes, { flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(candidate);
      if (createHash("sha256").update(existing).digest("hex") === sha256) return candidate;
    }
  }
  throw new DocumentDownloadError(`Too many files named like ${filename} in ${dir}.`);
}
