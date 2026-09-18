import { policyForCategory, resolveSectionPolicies } from "../core/section-policy.js";
export const SKILL_DISCOVERY_SOURCES = Object.freeze([
  {
    name: "ClawHub",
    domain: "clawhub.ai",
    url: "https://clawhub.ai/",
    query: "new trending official AI agent MCP OpenClaw workflow coding video image 3D Skills",
  },
  {
    name: "SkillHub",
    domain: "skillhub.cn",
    url: "https://skillhub.cn/",
    query: "最新 上新 热门 AI Skill Agent MCP OpenClaw 工作流 编程 视频 生图 3D",
  },
  {
    name: "skills.sh",
    domain: "skills.sh",
    url: "https://www.skills.sh/",
    query: "trending hot official AI agent workflow coding video image 3D Skills",
  },
  {
    name: "SkillsMP",
    domain: "skillsmp.com",
    url: "https://skillsmp.com/",
    query: "new trending updated Codex Claude agent skills workflow coding video image 3D SKILL.md",
  },
  {
    name: "GitHub Skill repositories",
    domain: "github.com",
    url: "https://github.com/",
    query: "SKILL.md agent skills OpenClaw Codex MCP workflow AI video image 3D",
  },
]);

const SKILL_SEARCH_TOPICS = SKILL_DISCOVERY_SOURCES.map((source) => ({
  section: "skill",
  query: `site:${source.domain} ${source.query}`,
  sourceHint: `Use ${source.name} for discovery and listing metadata, then verify functionality, installation, maintenance, and security claims against the creator's repository or official documentation.`,
}));

const SEARCH_TOPICS = [
  {
    section: "github",
    query: "GitHub new releases AI agents MCP workflows video image 3D coding OpenClaw official repository",
    sourceHint: "Prefer official repositories, releases, maintainer documentation, and license files.",
  },
  {
    section: "ai",
    query: "AI tools products open source releases official announcements",
    sourceHint: "Prefer official product pages, release notes, repositories, and company announcements.",
  },
  ...SKILL_SEARCH_TOPICS,
  {
    section: "business",
    query: "business finance technology trend official announcements regulatory filings company results",
    sourceHint: "Prefer company, exchange, regulator, and primary research sources.",
  },
  {
    section: "growth",
    query: "career skills productivity technology change official research data",
    sourceHint: "Prefer original research, public datasets, and primary publications.",
  },
];

export function resolveWebResearchCapability({
  hasWebSearch = false,
  hasWebBrowse = false,
  canDiscoverInstallableSkills = false,
} = {}) {
  if (hasWebSearch && hasWebBrowse) {
    return { mode: "host_web", canPublishVerifiedItems: true };
  }
  if (hasWebSearch) {
    return {
      mode: "search_only",
      canPublishVerifiedItems: false,
      reason: "Search results must be opened and verified before they can be published.",
    };
  }
  if (canDiscoverInstallableSkills) {
    return {
      mode: "discover_installable_skill",
      canPublishVerifiedItems: false,
      requiresUserApproval: true,
      nextAction: "Find public installable Skills with web-search and browsing capability; do not install one without explicit approval.",
    };
  }
  return {
    mode: "blocked",
    canPublishVerifiedItems: false,
    reason: "This client has no web-search capability and cannot discover an installable public Skill.",
  };
}

export function buildResearchPlan({ timeWindowHours = 24, now = new Date(), config = {} } = {}) {
  if (!Number.isFinite(timeWindowHours) || timeWindowHours <= 0) {
    throw new TypeError("timeWindowHours must be a positive number.");
  }

  // Each section searches its own window. News goes stale in a day; a
  // repository or a Skill often only becomes worth recommending several days
  // after it appears, so those draw from a pool and rank by what moved today.
  const policies = resolveSectionPolicies(config);
  const policyFor = (section) => policyForCategory(policies, section) ?? policyForCategory(policies, "ai");
  const windowStartFor = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const requested = Math.round(timeWindowHours);

  return {
    windowStart: windowStartFor(requested),
    windowEnd: now.toISOString(),
    timeWindowHours: requested,
    sectionWindows: policies.map((policy) => ({
      section: policy.key,
      label: policy.label,
      discoveryWindowHours: policy.discoveryWindowHours,
      highlightWindowHours: policy.highlightWindowHours,
      pooled: policy.pooled,
      minItems: policy.minItems,
      maxItems: policy.maxItems,
    })),
    queries: SEARCH_TOPICS.map((topic) => {
      const policy = policyFor(topic.section);
      // An explicit wider request (生成本周情报) widens every section; it never narrows a pool.
      const windowHours = Math.max(policy.discoveryWindowHours, requested);
      return {
        ...topic,
        discoveryWindowHours: windowHours,
        windowStart: windowStartFor(windowHours),
        pooled: policy.pooled,
        rankingRules: policy.pooled
          ? [
            `Draw candidates from the last ${Math.round(windowHours / 24)} days rather than the last 24 hours.`,
            "Rank first anything with a new release, a major update, or a first public launch in the last 24 hours.",
            "Skip anything already recommended in an earlier briefing.",
            `Return at most ${policy.maxItems}. Never pad toward ${policy.minItems} with weak or unmaintained projects; an omitted section is better than a padded one.`,
          ]
          : [
            `Use the last ${windowHours} hours only.`,
            `Return at most ${policy.maxItems}. Omit the section rather than padding it to reach ${policy.minItems}.`,
          ],
        verificationRules: [
          "Retain an official or first-party source for every publishable item.",
          "Find an independent second source for material claims.",
          "Discard duplicated, promotional, clickbait, and unsupported results.",
          ...(topic.section === "skill"
            ? ["Use directory listings only for discovery and platform metadata; verify capability claims with the creator's repository or official documentation."]
            : []),
        ],
      };
    }),
  };
}
