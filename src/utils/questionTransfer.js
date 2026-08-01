export function createQuestionBankPayload(
  questions,
  exportedAt = new Date().toISOString()
) {
  return {
    schemaVersion: 1,
    exportedAt,
    questions: questions.map((question) => ({
      title: question.title,
      answer: question.answer || "",
      category: question.category || "未分类",
      tags: [...(question.tags || [])],
      difficulty: question.difficulty || "基础",
    })),
  };
}
