import test from "node:test";
import assert from "node:assert/strict";
import { parseUserIntent } from "../src/clients/adapter.js";

test("rejects zero and unsafe research-hour requests", () => {
  assert.equal(parseUserIntent("生成最近0小时情报").type, "unknown");
  assert.equal(parseUserIntent("生成最近9007199254740992小时情报").type, "unknown");
});
