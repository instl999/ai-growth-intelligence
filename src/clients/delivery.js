export function resolveMessageDelivery({ hasMessageTool = false } = {}) {
  const contract = {
    required: true,
    tool: "message",
    target: "triggering_request_or_scheduled_job_destination",
    canDeliver: Boolean(hasMessageTool),
    completionCondition: "message_tool_confirmed",
    fallbackAllowed: false,
  };
  return contract.canDeliver
    ? contract
    : { ...contract, reason: "The host message tool is required for proactive briefing delivery." };
}