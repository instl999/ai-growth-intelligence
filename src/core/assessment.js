function distinctDomains(sources) {
  return new Set(sources.map((source) => new URL(source.url).hostname.toLowerCase()));
}

export function validateSources(item) {
  const reasons = [];
  const officialSources = item.sources.filter((source) => source.isOfficial);
  if (!officialSources.length) reasons.push("No official or first-party source is available.");
  if (item.materialClaim && distinctDomains(item.sources).size < 2) reasons.push("A material claim requires two independent source domains.");
  return { valid: reasons.length === 0, reasons };
}

export function scoreValue(item) {
  const signals = item.valueSignals ?? {};
  const breakdown = {
    efficiency: signals.efficiency ? 30 : 0,
    income: signals.income ? 30 : 0,
    trend: signals.trend ? 30 : 0,
    novelty: signals.novelty ? 10 : 0,
  };
  return { score: Object.values(breakdown).reduce((total, value) => total + value, 0), breakdown };
}

export function assessItem(item, { minimumScore = 60 } = {}) {
  const sourceValidation = validateSources(item);
  if (!sourceValidation.valid) return { item: { ...item, reviewStatus: "rejected" }, route: "rejected", sourceValidation, value: null };
  const value = scoreValue(item);
  if (value.score < minimumScore) return { item: { ...item, reviewStatus: "rejected" }, route: "rejected", sourceValidation, value, reasons: [`Value score ${value.score} is below the minimum ${minimumScore}.`] };
  return { item: { ...item, reviewStatus: "publishable" }, route: "publishable", sourceValidation, value };
}

export function routeItems(items, options) {
  const routed = { publishable: [], rejected: [] };
  for (const item of items) {
    const assessment = assessItem(item, options);
    if (assessment.route === "publishable") routed.publishable.push(assessment);
    else routed.rejected.push(assessment);
  }
  return routed;
}
