type CandidateQuestion = { title: string };

function bigrams(value: string) {
  const normalized = value.trim().toLocaleLowerCase().replace(/\s+/gu, '');
  if (normalized.length < 2) return new Set([normalized]);
  return new Set(
    Array.from({ length: normalized.length - 1 }, (_, index) =>
      normalized.slice(index, index + 2),
    ),
  );
}

export function titleSimilarity(left: string, right: string) {
  const a = bigrams(left);
  const b = bigrams(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function findSemanticCandidates(
  incoming: CandidateQuestion[],
  existing: Array<CandidateQuestion & { id: number }>,
  threshold = 0.65,
) {
  return incoming.flatMap((question, index) => {
    const matches = existing
      .map((candidate) => ({
        questionId: candidate.id,
        title: candidate.title,
        score: Number(
          titleSimilarity(question.title, candidate.title).toFixed(3),
        ),
      }))
      .filter((candidate) => candidate.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return matches.length
      ? [{ inputIndex: index + 1, title: question.title, matches }]
      : [];
  });
}
