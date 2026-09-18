import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IntelligenceStore, readJson, writeJsonAtomic } from "../src/storage/json-store.js";

test("reads fallback data and persists JSON atomically in an isolated directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "growth-intelligence-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  const file = path.join(root, "data.json");
  assert.deepEqual(await readJson(file, { empty: true }), { empty: true });
  await writeJsonAtomic(file, { saved: true });
  assert.deepEqual(await readJson(file, {}), { saved: true });
});

test("stores run records and fingerprint indexes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "growth-intelligence-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  const store = new IntelligenceStore({ root, runs: path.join(root, "runs") });
  await store.recordFingerprints([{ fingerprint: "abc" }]);
  assert.ok((await store.loadSeenFingerprints()).fingerprints.abc);
  await store.saveRun({ id: "run_1", items: [] });
  assert.deepEqual(await readJson(path.join(root, "runs", "run_1.json"), {}), { id: "run_1", items: [] });
});