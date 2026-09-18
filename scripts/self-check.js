import path from "node:path";
import { fileURLToPath } from "node:url";
import { performSelfCheck } from "./self-check-core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = performSelfCheck(root);
console.log(`Self-check passed (${result.scannedFiles} text files scanned for credential patterns).`);
