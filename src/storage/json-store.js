import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return clone(fallback);
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function runFileName(runId) {
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new TypeError("run.id may contain only letters, numbers, underscores, and hyphens.");
  return `${runId}.json`;
}

export class IntelligenceStore {
  constructor(dataPaths) {
    this.dataPaths = dataPaths;
    this.indexPath = path.join(dataPaths.root, "seen-fingerprints.json");
  }

  async loadSeenFingerprints() {
    return readJson(this.indexPath, { version: 1, fingerprints: {} });
  }

  async recordFingerprints(items) {
    const index = await this.loadSeenFingerprints();
    const seenAt = new Date().toISOString();
    for (const item of items) index.fingerprints[item.fingerprint] = seenAt;
    await writeJsonAtomic(this.indexPath, index);
    return index;
  }

  async saveRun(run) {
    await writeJsonAtomic(path.join(this.dataPaths.runs, runFileName(run.id)), run);
    return run;
  }
}