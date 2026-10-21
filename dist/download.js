import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
const ECFS_ORIGIN = "https://www.fcc.gov";
const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Longest stem kept from the server's filename, so the full name stays well under 255 bytes. */
const MAX_STEM = 100;
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
        .describe("1-based position of the document within the filing — the {n} in its " +
        "https://www.fcc.gov/ecfs/document/{id_submission}/{n} location URL. Defaults to 1."),
    output_dir: z
        .string()
        .min(1)
        .max(255)
        .optional()
        .describe("Optional subfolder of the user's download folder (ECFS_DOWNLOAD_DIR, default " +
        '~/Downloads/ecfs) to save into, e.g. "wt-09-209". It\'s created if missing. ' +
        "Absolute or ~ paths are accepted only if they are inside the download folder; " +
        "anything outside it is rejected. Omit unless the user asks for a subfolder. The " +
        "saved file always ends in .pdf."),
});
export class DocumentDownloadError extends Error {
    constructor(message) {
        super(message);
        this.name = "DocumentDownloadError";
    }
}
/** The ECFS website viewer page, and the PDF request that page makes. */
export function documentUrls(idSubmission, documentNumber) {
    return {
        viewerUrl: `${ECFS_ORIGIN}/ecfs/document/${idSubmission}/${documentNumber}`,
        pdfPath: `/ecfs/documents/${idSubmission}/${documentNumber}`,
    };
}
function expandHome(dir, home, p) {
    if (dir === "~")
        return home;
    if (dir.startsWith("~/") || dir.startsWith("~\\"))
        return p.join(home, dir.slice(2));
    return dir;
}
/**
 * The download root: ECFS_DOWNLOAD_DIR, else ~/Downloads/ecfs. It comes from user
 * config, not the model, so it's trusted and may be anywhere (or a symlink). An unset
 * plugin userConfig value can arrive as an empty or unexpanded "${...}" string, so both
 * count as unset.
 */
export function downloadRoot(env = process.env, home = os.homedir(), p = path) {
    const configured = env.ECFS_DOWNLOAD_DIR?.trim();
    const usable = configured && !configured.includes("${") ? configured : undefined;
    return p.resolve(expandHome(usable || p.join("~", "Downloads", "ecfs"), home, p));
}
/** True if `child` is `root` or below it. Both must be absolute paths of the same flavour. */
export function isWithin(root, child, p = path) {
    const rel = p.relative(root, child);
    return rel === "" || (rel.split(p.sep)[0] !== ".." && !p.isAbsolute(rel));
}
function outsideRoot(requested, root) {
    return new DocumentDownloadError(`output_dir must be inside the download folder ${root} (got ${requested}). ` +
        'Pass a subfolder name such as "wt-09-209", or omit output_dir. To save somewhere ' +
        "else, the user must change the download folder setting (ECFS_DOWNLOAD_DIR).");
}
/**
 * Where to save: the download root, or `output_dir` inside it. Relative values resolve
 * against the root; absolute and ~ values must already point inside it. This is a
 * lexical check only; prepareDownloadDir() repeats it on real paths.
 */
export function resolveDownloadDir(override, env = process.env, home = os.homedir(), p = path) {
    const root = downloadRoot(env, home, p);
    const requested = override?.trim();
    if (!requested)
        return { root, dir: root };
    const dir = p.resolve(root, expandHome(requested, home, p));
    if (!isWithin(root, dir, p))
        throw outsideRoot(requested, root);
    return { root, dir };
}
/**
 * Creates `dir` and returns its real path, without ever creating anything, or
 * resolving to anywhere, outside `root`.
 */
async function prepareDownloadDir(root, dir) {
    await mkdir(root, { recursive: true }); // trusted, user-configured
    const realRoot = await realpath(root);
    // Check the deepest existing ancestor before mkdir -p, so a symlink inside the root
    // can't make it create directories elsewhere.
    let existing = dir;
    for (;;) {
        let real;
        try {
            real = await realpath(existing);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            existing = path.dirname(existing);
            continue;
        }
        if (!isWithin(realRoot, real))
            throw outsideRoot(dir, root);
        break;
    }
    await mkdir(dir, { recursive: true });
    const realDir = await realpath(dir);
    if (!isWithin(realRoot, realDir))
        throw outsideRoot(dir, root);
    return realDir;
}
/** A filename safe to join onto the download dir: no path parts, no odd characters. */
export function safeFilename(name, fallback) {
    const base = path.basename((name ?? "").replace(/\\/g, "/"));
    const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
    return cleaned && cleaned !== "_" ? cleaned : fallback;
}
/** Pulls `filename` out of a Content-Disposition header, if present. */
export function filenameFromDisposition(header) {
    return header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];
}
/**
 * The saved filename: `{id}_{stem}.pdf` from the server's name, or `{id}-{n}.pdf` when it
 * has no usable one. Whatever extension the server suggests, the result ends in .pdf.
 */
export function pdfFilename(idSubmission, documentNumber, disposition) {
    const fallback = `${idSubmission}-${documentNumber}.pdf`;
    const name = safeFilename(filenameFromDisposition(disposition), fallback);
    if (name === fallback)
        return fallback;
    // safeFilename never returns an empty name or one starting with ".", so at least one
    // character always comes before a trailing ".pdf" and the stem is never empty.
    const stem = name.replace(/\.pdf$/i, "").replace(/\./g, "_").slice(0, MAX_STEM);
    return `${idSubmission}_${stem}.pdf`;
}
export function isPdf(bytes) {
    return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}
/**
 * Loads the ECFS viewer page in headless Chrome and captures the PDF the page
 * requests. Plain HTTP clients are refused by the site's bot protection, so the
 * document has to come through a real browser.
 */
async function fetchPdfViaBrowser(viewerUrl, pdfPath) {
    let chromium;
    try {
        ({ chromium } = await import("playwright-core"));
    }
    catch {
        throw new DocumentDownloadError("playwright-core is not installed; run `npm ci` in the fcc-ecfs-mcp directory.");
    }
    let browser;
    try {
        browser = await chromium.launch({ channel: "chrome", headless: true });
    }
    catch (cause) {
        throw new DocumentDownloadError("Couldn't start Google Chrome, which ecfs_download_document uses to fetch documents. " +
            `Install Google Chrome and try again. (${cause instanceof Error ? cause.message.split("\n")[0] : cause})`);
    }
    try {
        // Headless Chrome announces itself as "HeadlessChrome", which the ECFS site
        // refuses; present the same browser under its regular Chrome user agent.
        const probe = await browser.newPage();
        const userAgent = (await probe.evaluate(() => navigator.userAgent)).replace("HeadlessChrome/", "Chrome/");
        await probe.close();
        const context = await browser.newContext({ userAgent });
        const page = await context.newPage();
        const pdfResponse = page.waitForResponse((response) => new URL(response.url()).pathname === pdfPath, { timeout: DOWNLOAD_TIMEOUT_MS });
        // Don't leave an unhandled rejection behind if navigation fails first.
        pdfResponse.catch(() => { });
        const viewer = await page.goto(viewerUrl, {
            waitUntil: "domcontentloaded",
            timeout: DOWNLOAD_TIMEOUT_MS,
        });
        if (viewer && viewer.status() >= 400) {
            throw new DocumentDownloadError(`The ECFS website refused the document page (HTTP ${viewer.status()}): ${viewerUrl}`);
        }
        let response;
        try {
            response = await pdfResponse;
        }
        catch {
            throw new DocumentDownloadError(`Timed out waiting for the document from ${viewerUrl}. Check that the submission ID ` +
                "and document number exist (ecfs_search_documents lists a filing's documents).");
        }
        if (response.status() !== 200) {
            throw new DocumentDownloadError(`The ECFS website returned HTTP ${response.status()} for ${viewerUrl}.`);
        }
        return {
            body: await response.body(),
            contentType: response.headers()["content-type"],
            disposition: response.headers()["content-disposition"],
        };
    }
    finally {
        await browser.close();
    }
}
export async function downloadDocument(input, env = process.env) {
    const documentNumber = input.document_number ?? 1;
    // Validate output_dir before launching Chrome or touching the filesystem.
    const { root, dir } = resolveDownloadDir(input.output_dir, env);
    const { viewerUrl, pdfPath } = documentUrls(input.id_submission, documentNumber);
    const { body, contentType, disposition } = await fetchPdfViaBrowser(viewerUrl, pdfPath);
    if (!isPdf(body)) {
        throw new DocumentDownloadError(`Expected a PDF from ${viewerUrl} but got ${contentType ?? "an unknown content type"}.`);
    }
    const filename = pdfFilename(input.id_submission, documentNumber, disposition);
    const realDir = await prepareDownloadDir(root, dir);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const savedPath = await writeWithoutClobbering(realDir, filename, body, sha256);
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
async function writeWithoutClobbering(dir, filename, bytes, sha256) {
    const { name, ext } = path.parse(filename);
    for (let i = 0; i < 1000; i++) {
        const candidate = path.join(dir, i === 0 ? filename : `${name}-${i}${ext}`);
        try {
            await writeFile(candidate, bytes, { flag: "wx" });
            return candidate;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            const existing = await readFile(candidate);
            if (createHash("sha256").update(existing).digest("hex") === sha256)
                return candidate;
        }
    }
    throw new DocumentDownloadError(`Too many files named like ${filename} in ${dir}.`);
}
