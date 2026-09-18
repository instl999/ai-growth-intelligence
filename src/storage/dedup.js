export function splitByFingerprint(items, fingerprintIndex = {}) {
  const unique = [];
  const duplicates = [];
  const seenInBatch = new Set();

  for (const item of items) {
    if (fingerprintIndex[item.fingerprint] || seenInBatch.has(item.fingerprint)) {
      duplicates.push(item);
      continue;
    }
    seenInBatch.add(item.fingerprint);
    unique.push(item);
  }

  return { unique, duplicates };
}
