import test from "node:test";
import assert from "node:assert/strict";
import { createIntelligenceItem } from "../src/core/models.js";
import { prepareArticlePreview } from "../src/core/preview-workflow.js";
import {
  MESSAGE_DELIVERY_STEP,
  WECHAT_DRAFT_STEP,
  buildDeliveryPlan,
} from "../src/core/delivery-plan.js";

// Sections filter by their own discovery window against the clock they are
// given, so every fixture date is relative to a pinned NOW and that same NOW is
// passed to prepareArticlePreview. An absolute date here silently rots: the
// items age out of their window, every section falls below its minimum, and the
// whole file starts failing with "no_briefing" a day after it was written.
const NOW = new Date("2026-09-08T12:00:00.000Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

function candidate(index, category) {
  return createIntelligenceItem({
    category,
    headline: `${category} update ${index}`,
    summary: "It helps reduce repetitive work.",
    whatHappened: "A verified capability became available.",
    whyItMatters: "It can reduce time spent on repetitive work.",
    personalImpact: "It can free time for higher-value tasks.",
    actions: ["Test the workflow on one repetitive task."],
    occurredAt: hoursAgo(2),
    sources: [{
      title: `Official launch ${index}`,
      url: `https://example.com/${category}/${index}`,
      publisher: "Example",
      publishedAt: hoursAgo(2).slice(0, 10),
      isOfficial: true,
    }],
    valueSignals: { efficiency: true, income: true, trend: true },
  });
}

function readyPreview() {
  const items = [];
  for (const category of ["github", "ai"]) for (let i = 1; i <= 5; i += 1) items.push(candidate(i, category));
  const preview = prepareArticlePreview({ items, now: NOW });
  assert.equal(preview.status, "delivery_ready");
  return preview;
}

const step = (plan, id) => plan.steps.find((entry) => entry.id === id);

test("message delivery is the only step that can complete a run", () => {
  const plan = buildDeliveryPlan({
    preview: readyPreview(),
    config: { wechatDraftBox: { enabled: true, dryRun: false } },
    capabilities: { hasMessageTool: true },
  });
  assert.deepEqual(plan.completionRequires, [MESSAGE_DELIVERY_STEP]);
  assert.ok(!plan.completionRequires.includes(WECHAT_DRAFT_STEP), "a draft must never complete a run");
});

test("the WeChat step is ordered after delivery and marked optional", () => {
  const plan = buildDeliveryPlan({
    preview: readyPreview(),
    config: { wechatDraftBox: { enabled: true, dryRun: true } },
    capabilities: { hasMessageTool: true },
  });
  const wechat = step(plan, WECHAT_DRAFT_STEP);
  assert.equal(wechat.required, false);
  assert.equal(wechat.runsAfter, MESSAGE_DELIVERY_STEP);
  assert.ok(wechat.order > step(plan, MESSAGE_DELIVERY_STEP).order);
});

test("a disabled WeChat feature is reported, not silently omitted", () => {
  const plan = buildDeliveryPlan({ preview: readyPreview(), config: {}, capabilities: { hasMessageTool: true } });
  const wechat = step(plan, WECHAT_DRAFT_STEP);
  assert.equal(wechat.enabled, false);
  assert.equal(wechat.canProceed, false);
  assert.equal(wechat.blockedReason, "wechat_draft_box_disabled");
  assert.equal(wechat.command, null);
});

test("the suggested command matches the configured mode", () => {
  const dry = buildDeliveryPlan({
    preview: readyPreview(),
    config: { wechatDraftBox: { enabled: true, dryRun: true } },
    capabilities: { hasMessageTool: true },
  });
  assert.match(step(dry, WECHAT_DRAFT_STEP).command, /--mode dry_run$/u);

  const live = buildDeliveryPlan({
    preview: readyPreview(),
    config: { wechatDraftBox: { enabled: true, dryRun: false } },
    capabilities: { hasMessageTool: true },
  });
  assert.match(step(live, WECHAT_DRAFT_STEP).command, /--acknowledge-write$/u);
});

test("a host without the message tool blocks delivery even when WeChat is ready", () => {
  const plan = buildDeliveryPlan({
    preview: readyPreview(),
    config: { wechatDraftBox: { enabled: true, dryRun: false } },
    capabilities: { hasMessageTool: false },
  });
  const delivery = step(plan, MESSAGE_DELIVERY_STEP);
  assert.equal(delivery.canProceed, false);
  assert.ok(delivery.blockedReason);
  assert.deepEqual(plan.completionRequires, [MESSAGE_DELIVERY_STEP], "WeChat cannot stand in for delivery");
});

test("no briefing means no steps and nothing outstanding", () => {
  const plan = buildDeliveryPlan({
    preview: prepareArticlePreview({ items: [candidate(1, "ai")], now: NOW }),
    config: { wechatDraftBox: { enabled: true } },
    capabilities: { hasMessageTool: true },
  });
  assert.equal(plan.status, "no_briefing");
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.completionRequires, []);
});

test("a configuration carrying credentials is rejected while planning", () => {
  assert.throws(
    () => buildDeliveryPlan({
      preview: readyPreview(),
      config: { wechatDraftBox: { enabled: true, appSecret: "x" } },
      capabilities: { hasMessageTool: true },
    }),
    (error) => error.code === "credentials_in_config",
  );
});

test("a missing preview is refused", () => {
  assert.throws(() => buildDeliveryPlan({}), TypeError);
});
