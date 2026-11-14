import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL(".vite/manifest.json", dist), "utf8"),
);
const mainFiles = [
  ...new Set(Object.values(manifest).map((chunk) => chunk.file)),
].filter((file) => file.endsWith(".js"));
const mainChunks = await Promise.all(
  mainFiles.map(async (file) => ({
    file,
    bytes: (await stat(new URL(file, dist))).size,
  })),
);
for (const chunk of mainChunks) {
  assert(
    !/excel(js)?[.-]/i.test(chunk.file),
    `Excel code entered the UI graph: ${chunk.file}`,
  );
  assert(chunk.bytes <= 500_000, `UI chunk exceeds 500 KB: ${chunk.file}`);
}

const assets = await readdir(new URL("assets/", dist));
const excelAssets = assets.filter((file) => /^exceljs.*\.js$/.test(file));
assert.equal(
  excelAssets.length,
  1,
  "Build must contain a single ExcelJS worker dependency",
);
const workers = assets.filter((file) =>
  /^file-import\.worker-.*\.js$/.test(file),
);
assert.equal(workers.length, 1, "Build must contain the file worker entry");
const workerBytes = (await stat(new URL(`assets/${workers[0]}`, dist))).size;
assert(
  workerBytes < 10_000,
  "Worker entry must defer workbook parsing until a file task",
);

console.log(
  JSON.stringify(
    {
      success: true,
      dist: fileURLToPath(dist),
      mainChunks,
      excelJsCopies: excelAssets.length,
      excelJsWorkerOnly: true,
      workerEntryBytes: workerBytes,
      excelJsBytes: (await stat(new URL(`assets/${excelAssets[0]}`, dist)))
        .size,
    },
    null,
    2,
  ),
);
