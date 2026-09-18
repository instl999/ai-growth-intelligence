import test from "node:test";
import assert from "node:assert/strict";
import { resolveMessageDelivery } from "../src/clients/delivery.js";

test("requires confirmed proactive delivery through the host message tool", () => {
  assert.deepEqual(resolveMessageDelivery({ hasMessageTool: true }), {
    required: true,
    tool: "message",
    target: "triggering_request_or_scheduled_job_destination",
    canDeliver: true,
    completionCondition: "message_tool_confirmed",
    fallbackAllowed: false,
  });

  const unavailable = resolveMessageDelivery();
  assert.equal(unavailable.required, true);
  assert.equal(unavailable.canDeliver, false);
  assert.equal(unavailable.fallbackAllowed, false);
  assert.match(unavailable.reason, /message tool is required/);
});