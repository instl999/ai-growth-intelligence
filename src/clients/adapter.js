import { resolveMessageDelivery } from "./delivery.js";
import { getGitHubAutomationSafetyContract } from "../github/automation.js";
import { buildResearchPlan, resolveWebResearchCapability } from "./web-search.js";

export const SUPPORTED_CLIENTS = new Set(["openclaw", "qclaw", "workbuddy", "generic"]);

function parseGitHubAutomationIntent(normalized) {
  const mentionsFeature = /github\s*自动\s*fork\s*并整理|github\s*auto[- ]?fork(?:[- ]?and[- ]?organize)?/iu.test(normalized);
  if (!mentionsFeature) return null;
  const disable = /不需要|不要(?:启用|开启|打开|执行|运行|写入)?|关闭|停用|禁用|disable|off/iu.test(normalized);
  const enable = !disable && /启用|开启|打开|需要|enable|on/iu.test(normalized);
  const apply = !disable && /执行|运行|apply|live|写入/iu.test(normalized);
  return {
    type: "github_auto_fork_and_organize",
    action: disable ? "disable" : enable ? "enable" : "explain",
    mode: apply ? "apply" : "dry_run",
  };
}

export function parseUserIntent(text) {
  const normalized = String(text ?? "").trim();
  const githubAutomationIntent = parseGitHubAutomationIntent(normalized);
  if (githubAutomationIntent) return githubAutomationIntent;
  const timeWindowMatch = normalized.match(/^生成最近(\d+)小时(?:情报|日报)$/u);
  if (timeWindowMatch) {
    const hours = Number(timeWindowMatch[1]);
    return Number.isSafeInteger(hours) && hours > 0
      ? { type: "research", timeWindowHours: hours }
      : { type: "unknown", text: normalized };
  }
  if (["生成今日情报", "生成今日日报", "生成AI成长情报"].includes(normalized)) return { type: "research", timeWindowHours: 24 };
  if (normalized === "生成本周情报") return { type: "research", timeWindowHours: 24 * 7 };
  return { type: "unknown", text: normalized };
}

export function createClientAdapter({ client = "generic", capabilities = {} } = {}) {
  if (!SUPPORTED_CLIENTS.has(client)) throw new TypeError(`Unsupported client: ${client}`);
  const research = resolveWebResearchCapability(capabilities);
  const delivery = resolveMessageDelivery({ hasMessageTool: capabilities.hasMessageTool });
  return {
    client,
    research,
    delivery,
    githubAutomation: getGitHubAutomationSafetyContract(capabilities.githubAutomation),
    createResearchPlan(timeWindowHours = 24) {
      return research.mode !== "host_web" ? { research, plan: null } : { research, plan: buildResearchPlan({ timeWindowHours }) };
    },
  };
}
