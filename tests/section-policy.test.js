import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SECTION_POLICIES,
  evaluateRecency,
  itemActivityAt,
  policyForCategory,
  rankSectionItems,
  resolveSectionPolicies,
} from "../src/core/section-policy.js";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
const policies = resolveSectionPolicies();
const named = (key) => policies.find((policy) => policy.key === key);

test("news sections keep a 24 hour window, project sections get seven days", () => {
  assert.equal(named("ai").discoveryWindowHours, 24);
  assert.equal(named("general").discoveryWindowHours, 24);
  assert.equal(named("github").discoveryWindowHours, 24 * 7);
  assert.equal(named("skill").discoveryWindowHours, 24 * 7);
});

test("every section still highlights the last 24 hours and caps at ten", () => {
  for (const policy of policies) {
    assert.equal(policy.highlightWindowHours, 24);
    assert.equal(policy.minItems, 5);
    assert.equal(policy.maxItems, 10);
  }
});

test("categories map onto exactly one section", () => {
  assert.equal(policyForCategory(policies, "github").key, "github");
  assert.equal(policyForCategory(policies, "skill").key, "skill");
  assert.equal(policyForCategory(policies, "business").key, "general");
  assert.equal(policyForCategory(policies, "growth").key, "general");
  assert.equal(policyForCategory(policies, "unknown"), null);
});

test("activity uses the later of the first appearance and the latest update", () => {
  const item = { occurredAt: hoursAgo(120), lastActivityAt: hoursAgo(3) };
  assert.equal(itemActivityAt(item).toISOString(), hoursAgo(3));
  assert.equal(itemActivityAt({ occurredAt: hoursAgo(5) }).toISOString(), hoursAgo(5));
  assert.equal(itemActivityAt({}), null);
  assert.equal(itemActivityAt({ occurredAt: "not a date" }), null);
});

test("a repository published a week ago that released today counts as today", () => {
  const item = { occurredAt: hoursAgo(6 * 24), lastActivityAt: hoursAgo(2) };
  const recency = evaluateRecency(item, named("github"), NOW);
  assert.equal(recency.withinWindow, true);
  assert.equal(recency.recentlyUpdated, true, "the release, not the publication date, decides");
});

test("the same repository is out of scope for a 24 hour news section", () => {
  const item = { occurredAt: hoursAgo(6 * 24) };
  assert.equal(evaluateRecency(item, named("ai"), NOW).withinWindow, false);
  assert.equal(evaluateRecency(item, named("github"), NOW).withinWindow, true);
});

test("anything older than the pool window is still excluded", () => {
  const item = { occurredAt: hoursAgo(9 * 24) };
  const recency = evaluateRecency(item, named("github"), NOW);
  assert.equal(recency.withinWindow, false);
  assert.equal(recency.recentlyUpdated, false);
});

test("a slightly future timestamp is treated as current, not discarded", () => {
  const item = { occurredAt: new Date(NOW.getTime() + 90 * 1000).toISOString() };
  assert.equal(evaluateRecency(item, named("ai"), NOW).withinWindow, true);
});

test("items updated in the last day rank ahead of older pool entries", () => {
  const items = [
    { id: "old-a", occurredAt: hoursAgo(5 * 24) },
    { id: "fresh", occurredAt: hoursAgo(6 * 24), lastActivityAt: hoursAgo(4) },
    { id: "old-b", occurredAt: hoursAgo(2 * 24) },
  ];
  const ranked = rankSectionItems(items, named("github"), NOW);
  assert.deepEqual(ranked.selected.map((item) => item.id), ["fresh", "old-b", "old-a"]);
  assert.equal(ranked.selected[0].recentlyUpdated, true);
  assert.equal(ranked.selected[1].recentlyUpdated, false);
  assert.equal(ranked.recentlyUpdatedCount, 1);
});

test("the section cap keeps a wide pool from becoming a list dump", () => {
  const items = Array.from({ length: 18 }, (_, index) => ({ id: `r${index}`, occurredAt: hoursAgo(index + 1) }));
  const ranked = rankSectionItems(items, named("github"), NOW);
  assert.equal(ranked.selected.length, 10);
  assert.equal(ranked.eligibleCount, 18);
  assert.ok(ranked.excluded.some((entry) => entry.reason === "section_cap"));
});

test("out-of-window candidates are reported with a reason, not dropped silently", () => {
  const ranked = rankSectionItems(
    [{ id: "stale", occurredAt: hoursAgo(30 * 24) }, { id: "undated" }],
    named("github"),
    NOW,
  );
  assert.equal(ranked.selected.length, 0);
  assert.deepEqual(
    ranked.excluded.map((entry) => entry.reason).sort(),
    ["missing_activity_date", "outside_discovery_window"],
  );
});

test("the minimum is reported rather than enforced by the ranker", () => {
  const four = Array.from({ length: 4 }, (_, index) => ({ id: `r${index}`, occurredAt: hoursAgo(index + 1) }));
  assert.equal(rankSectionItems(four, named("github"), NOW).meetsMinimum, false);
  const five = [...four, { id: "r4", occurredAt: hoursAgo(5) }];
  assert.equal(rankSectionItems(five, named("github"), NOW).meetsMinimum, true);
});

test("configuration can retune a section within bounds", () => {
  const tuned = resolveSectionPolicies({ sections: { github: { discoveryWindowHours: 72, maxItems: 6 } } });
  const github = tuned.find((policy) => policy.key === "github");
  assert.equal(github.discoveryWindowHours, 72);
  assert.equal(github.maxItems, 6);
  assert.equal(github.minItems, 5, "untouched fields keep their default");
});

test("out-of-range and nonsense overrides fall back instead of breaking selection", () => {
  const tuned = resolveSectionPolicies({
    sections: { ai: { discoveryWindowHours: -5 }, skill: { maxItems: 2, minItems: 5 }, nope: { minItems: 99 } },
  });
  assert.equal(tuned.find((policy) => policy.key === "ai").discoveryWindowHours, 1, "clamped, not negative");
  const skill = tuned.find((policy) => policy.key === "skill");
  assert.ok(skill.maxItems >= skill.minItems, "a cap below the minimum would be unsatisfiable");
  assert.equal(tuned.length, DEFAULT_SECTION_POLICIES.length, "unknown keys do not create sections");
});
