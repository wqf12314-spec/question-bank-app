export function normalizeQuestionTitle(title) {
  return String(title ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "")
    .replace(/[?？!！。]+$/u, "");
}

export function dedupeQuestionsByTitle(questions) {
  const seenTitles = new Set();
  const uniqueQuestions = [];
  let duplicateCount = 0;

  for (const question of questions) {
    const normalizedTitle = normalizeQuestionTitle(question?.title);

    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      duplicateCount += 1;
      continue;
    }

    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }
    uniqueQuestions.push(question);
  }

  return { questions: uniqueQuestions, duplicateCount };
}

export function filterNewQuestions(existingQuestions, incomingQuestions) {
  const seenTitles = new Set(
    existingQuestions
      .map((question) => normalizeQuestionTitle(question?.title))
      .filter(Boolean)
  );
  const newQuestions = [];
  let duplicateCount = 0;

  for (const question of incomingQuestions) {
    const normalizedTitle = normalizeQuestionTitle(question?.title);

    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      duplicateCount += 1;
      continue;
    }

    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }
    newQuestions.push(question);
  }

  return { questions: newQuestions, duplicateCount };
}

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
