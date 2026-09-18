import path from "node:path";
import { mkdir } from "node:fs/promises";

export const SKILL_DIRECTORY_NAME = "growth-intelligence";

function pathForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function getDataDirectory({
  platform = process.platform,
  env = process.env,
  homedir,
  skillDirectoryName = SKILL_DIRECTORY_NAME,
} = {}) {
  const fallbackHome = homedir ?? env.HOME ?? env.USERPROFILE;
  const home = platform === "win32" ? env.USERPROFILE ?? fallbackHome : fallbackHome;
  if (!home) throw new Error("Cannot determine the current user's home directory.");
  return pathForPlatform(platform).join(home, "Documents", skillDirectoryName);
}

export function getDataPaths(options = {}) {
  const root = getDataDirectory(options);
  const pathApi = pathForPlatform(options.platform ?? process.platform);
  return {
    root,
    articles: pathApi.join(root, "articles"),
    logs: pathApi.join(root, "logs"),
    runs: pathApi.join(root, "runs"),
    githubAutomation: pathApi.join(root, "github-auto-fork-and-organize"),
  };
}

export async function ensureDataDirectories(options = {}) {
  const locations = getDataPaths(options);
  await Promise.all(Object.values(locations).map((location) => mkdir(location, { recursive: true })));
  return locations;
}
