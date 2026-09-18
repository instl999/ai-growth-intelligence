/**
 * The ordered steps that finish a briefing run.
 *
 * Delivery through the host `message` tool is the only step that can complete a
 * run. Pushing the same briefing into the WeChat draft box is an optional extra
 * that happens afterwards and never substitutes for it: a draft nobody has
 * published has reached no one. That invariant is expressed here rather than
 * left to prose, so `completionRequires` can be asserted against.
 */

import { resolveMessageDelivery } from "../clients/delivery.js";
import { normalizeWechatDraftConfig } from "../wechat/draft.js";

export const MESSAGE_DELIVERY_STEP = "message_delivery";
export const WECHAT_DRAFT_STEP = "wechat_draft";

/**
 * @param {object} options
 * @param {object} options.preview       Result of prepareArticlePreview().
 * @param {object} [options.config]      Full configuration document.
 * @param {object} [options.capabilities] Host capabilities, notably hasMessageTool.
 * @returns {{status: string, steps: object[], completionRequires: string[]}}
 */
export function buildDeliveryPlan({ preview, config = {}, capabilities = {} } = {}) {
  if (!preview?.status) throw new TypeError("A prepared article preview is required.");
  const wechat = normalizeWechatDraftConfig(config);
  const delivery = resolveMessageDelivery({ hasMessageTool: capabilities.hasMessageTool });

  if (preview.status !== "delivery_ready") {
    return {
      status: "no_briefing",
      reason: preview.reason ?? "本时段无合格高价值情报",
      steps: [],
      // Nothing to deliver, so nothing is outstanding.
      completionRequires: [],
    };
  }

  const steps = [
    {
      id: MESSAGE_DELIVERY_STEP,
      order: 1,
      required: true,
      tool: "message",
      canProceed: delivery.canDeliver,
      blockedReason: delivery.canDeliver ? null : delivery.reason,
      completionCondition: "message_tool_confirmed",
      note: "A normal assistant response, a saved file, or a preview is not delivery.",
    },
  ];

  steps.push({
    id: WECHAT_DRAFT_STEP,
    order: 2,
    required: false,
    enabled: wechat.enabled,
    // Even when enabled this runs only after delivery is confirmed.
    runsAfter: MESSAGE_DELIVERY_STEP,
    dryRunOnly: wechat.dryRun,
    canProceed: wechat.enabled,
    blockedReason: wechat.enabled ? null : "wechat_draft_box_disabled",
    command: wechat.enabled
      ? `node src/cli/index.js wechat-draft --config config.json --items items.json --mode ${wechat.dryRun ? "dry_run" : "apply --acknowledge-write"}`
      : null,
    note: "Creates a draft for human review. It never publishes and never completes the run.",
  });

  return {
    status: "delivery_ready",
    articleTitle: preview.article.title,
    steps,
    // The WeChat step is deliberately absent: a draft cannot complete a run.
    completionRequires: [MESSAGE_DELIVERY_STEP],
  };
}
