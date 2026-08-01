export function getQuestionHistory(records, questionId) {
  const targetId = String(questionId);

  return records
    .filter((record) => record.questionId === targetId)
    .slice()
    .sort((a, b) => {
      return new Date(b.practicedAt) - new Date(a.practicedAt);
    });
}
