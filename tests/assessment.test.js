import test from "node:test";
import assert from "node:assert/strict";
import { assessItem, routeItems, scoreValue, validateSources } from "../src/core/assessment.js";
import { createIntelligenceItem } from "../src/core/models.js";
function createItem(overrides = {}) { return createIntelligenceItem({ category: "ai", headline: "A verified AI workflow release", summary: "It helps people complete repetitive work faster.", occurredAt: "2026-07-14T00:00:00.000Z", sources: [{ title: "Official release", url: "https://official.example/release", publisher: "Official Example", publishedAt: "2026-07-14", isOfficial: true }], valueSignals: { efficiency: true, income: true, trend: true }, ...overrides }); }
test("prioritizes efficiency, income, and trend signals", () => { assert.equal(scoreValue(createItem()).score, 90); });
test("requires first-party sources and independent support for material claims", () => { assert.equal(validateSources(createItem()).valid, true); assert.equal(assessItem(createItem({ materialClaim: true })).route, "rejected"); });
test("does not topic-filter candidates", () => { assert.equal(assessItem(createItem({ headline: "Political election update" })).route, "publishable"); assert.equal(assessItem(createItem({ headline: "Buy now for guaranteed return" })).route, "publishable"); });
test("publishes only high-value and verified content", () => { assert.equal(assessItem(createItem({ valueSignals: { novelty: true } })).route, "rejected"); const routed = routeItems([createItem(), createItem({ headline: "Political election update" })]); assert.equal(routed.publishable.length, 2); assert.equal("internalReview" in routed, false); });
