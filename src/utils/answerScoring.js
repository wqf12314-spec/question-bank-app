export function scoreAnswer({ answer = "", expected = "", tags = [] }) {
  const normalized = String(answer).toLocaleLowerCase();
  const expectedText = String(expected).toLocaleLowerCase();
  const keywords = [
    ...new Set([
      ...String(tags)
        .split(/[,，\s]+/u)
        .filter(Boolean),
      ...expectedText
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1),
    ]),
  ];
  const matched = keywords.filter((keyword) => normalized.includes(keyword));
  const coverage = keywords.length ? matched.length / keywords.length : 0;
  const structure = /(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+)/u.test(answer) ? 1 : 0;
  return {
    keywordCoverage: Number(coverage.toFixed(2)),
    structureCompleteness: structure,
    matchedKeywords: matched,
    note: "仅作复习提示，不代表绝对正确。",
  };
}
