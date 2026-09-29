import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { downloadDocument } from "../../src/download.js";

// Downloads a real document from the ECFS website through headless Chrome. Needs Google
// Chrome installed; run with `npm run test:download`. Not part of CI: the site blocks
// many datacenter networks, so a failure there wouldn't say anything about the code.
// ARRL's comments in WT Docket 09-209 (issue #1): an 18-page, 58,286-byte PDF.
const ID_SUBMISSION = "6015544108";

describe("ECFS document download (live)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ecfs-live-dl-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("downloads the ARRL's 09-209 comments as a PDF", async () => {
    const res = await downloadDocument({ id_submission: ID_SUBMISSION, output_dir: dir });

    expect(res.filename).toBe("6015544108_7020397485.pdf");
    expect(res.byte_size).toBe(58286);
    expect(readFileSync(res.saved_path).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
