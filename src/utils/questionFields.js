export function parseTags(value) {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function filterQuestions(
  questions,
  keyword,
  selectedTag,
  selectedCategory = "",
) {
  const normalizedKeyword = keyword.trim().toLowerCase();

  return questions.filter((question) => {
    const tags = question.tags || [];
    const searchableText = [question.title, question.answer, ...tags]
      .join(" ")
      .toLowerCase();
    const matchesKeyword = searchableText.includes(normalizedKeyword);
    const matchesTag = !selectedTag || tags.includes(selectedTag);
    const matchesCategory =
      !selectedCategory || question.category === selectedCategory;

    return matchesKeyword && matchesTag && matchesCategory;
  });
}

export function getTopicsForCategory(questions, category) {
  const matchingQuestions = category
    ? questions.filter((question) => question.category === category)
    : questions;
  const topics = matchingQuestions.flatMap((question) => {
    return (question.tags || []).filter((topic) => topic !== question.category);
  });

  return [...new Set(topics)];
}

export function filterRecommendations(questions, category, selectedTags) {
  return questions.filter((question) => {
    const tags = question.tags || [];
    const matchesCategory = !category || question.category === category;
    const matchesTags = selectedTags.every((tag) => tags.includes(tag));

    return matchesCategory && matchesTags;
  });
}
