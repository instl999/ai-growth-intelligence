import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const testsDirectory = path.join(scriptsDirectory, "..", "tests");
const entries = await readdir(testsDirectory, { withFileTypes: true });
const testFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "en"));

for (const testFile of testFiles) await import(pathToFileURL(path.join(testsDirectory, testFile)).href);
