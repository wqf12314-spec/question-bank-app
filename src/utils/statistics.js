export function getStats(questions, records) {
  const categoryCounts = questions.reduce((counts, question) => {
    const category = question.category || "未分类";
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});

  const tagCounts = questions
    .flatMap((question) => {
      return (question.tags || []).filter((tag) => tag !== question.category);
    })
    .reduce((counts, tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
      return counts;
    }, {});

  const practicedIds = new Set(
    records.map((record) => String(record.questionId))
  );

  const latestByQuestion = new Map();
  for (const record of records) {
    latestByQuestion.set(String(record.questionId), record);
  }

  let masteredCount = 0;
  let reviewCount = 0;

  for (const record of latestByQuestion.values()) {
    if (record.result === "correct") masteredCount += 1;
    if (record.result === "wrong" || record.result === "partial") {
      reviewCount += 1;
    }
  }

  const totalQuestions = questions.length;
  const practicedCount = practicedIds.size;
  const practicePercent = totalQuestions === 0
    ? 0
    : Math.round((practicedCount / totalQuestions) * 100);

  return {
    totalQuestions,
    practiceCount: records.length,
    practicedCount,
    masteredCount,
    reviewCount,
    unpracticedCount: Math.max(totalQuestions - practicedCount, 0),
    practicePercent,
    categoryCounts,
    tagCounts,
  };
}

function toDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildPracticeActivity(records, days = 84, today = new Date()) {
  const counts = records.reduce((result, record) => {
    const date = toDateKey(record.practicedAt);
    result[date] = (result[date] || 0) + 1;
    return result;
  }, {});

  const currentDay = new Date(today);
  currentDay.setHours(0, 0, 0, 0);

  const gridEnd = new Date(currentDay);
  gridEnd.setDate(currentDay.getDate() + (6 - currentDay.getDay()));

  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridEnd.getDate() - days + 1);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = toDateKey(date);
    const count = counts[dateKey] || 0;

    return {
      date: dateKey,
      count,
      level: count === 0 ? 0 : Math.min(count, 4),
      isFuture: date > currentDay,
    };
  });
}
