import test from "node:test";
import assert from "node:assert/strict";
import { getDataDirectory, getDataPaths } from "../src/storage/paths.js";

test("uses USERPROFILE/Documents on Windows", () => {
  assert.equal(getDataDirectory({ platform: "win32", env: { USERPROFILE: "C:\\Users\\Ada" } }), "C:\\Users\\Ada\\Documents\\growth-intelligence");
});

test("uses HOME/Documents on macOS and Linux", () => {
  assert.equal(getDataDirectory({ platform: "darwin", env: { HOME: "/Users/ada" } }), "/Users/ada/Documents/growth-intelligence");
  assert.equal(getDataDirectory({ platform: "linux", env: { HOME: "/home/ada" } }), "/home/ada/Documents/growth-intelligence");
});

test("returns private article, log, run, and GitHub automation paths", () => {
  const paths = getDataPaths({ platform: "linux", env: { HOME: "/home/ada" } });
  assert.equal(paths.articles, "/home/ada/Documents/growth-intelligence/articles");
  assert.equal(paths.logs, "/home/ada/Documents/growth-intelligence/logs");
  assert.equal(paths.runs, "/home/ada/Documents/growth-intelligence/runs");
  assert.equal(paths.githubAutomation, "/home/ada/Documents/growth-intelligence/github-auto-fork-and-organize");
  assert.equal("dashboard" in paths, false);
  assert.equal("covers" in paths, false);
});
