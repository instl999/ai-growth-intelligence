import test from "node:test";
import assert from "node:assert/strict";
import { createClientAdapter, parseUserIntent } from "../src/clients/adapter.js";
import { runCli } from "../src/cli/index.js";

test("parses manual research requests and has no webpage intent", () => {
  assert.deepEqual(parseUserIntent("生成今日情报"), { type: "research", timeWindowHours: 24 });
  assert.deepEqual(parseUserIntent("生成最近48小时情报"), { type: "research", timeWindowHours: 48 });
  assert.deepEqual(parseUserIntent("生成本周情报"), { type: "research", timeWindowHours: 168 });
  assert.equal(parseUserIntent("启动 AI 成长情报网页").type, "unknown");
});

test("provides a shared capability contract for supported clients", () => {
  const adapter = createClientAdapter({
    client: "openclaw",
    capabilities: { hasWebSearch: true, hasWebBrowse: true, hasMessageTool: true },
  });
  assert.equal(adapter.createResearchPlan().research.mode, "host_web");
  assert.equal(adapter.delivery.tool, "message");
  assert.equal(adapter.delivery.canDeliver, true);
  assert.equal(createClientAdapter({ client: "qclaw" }).research.mode, "blocked");
  assert.throws(() => createClientAdapter({ client: "unknown" }), /Unsupported client/u);
});

test("CLI diagnostics do not perform side effects or expose webpage commands", () => {
  const result = runCli(["capabilities", "--client", "generic", "--web-search", "--web-browse", "--message-tool"]);
  assert.equal(result.research.mode, "host_web");
  assert.equal(result.delivery.canDeliver, true);
  assert.deepEqual(runCli(["intent", "生成今日情报"]), { type: "research", timeWindowHours: 24 });
  assert.doesNotMatch(JSON.stringify(runCli([])), /dashboard|网页/iu);
});
