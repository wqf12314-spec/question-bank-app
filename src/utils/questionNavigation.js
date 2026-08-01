export function getAdjacentQuestion(questions, currentId, offset) {
  if (questions.length === 0) return null;

  const currentIndex = questions.findIndex((question) => {
    return String(question.id) === String(currentId);
  });

  if (currentIndex === -1) {
    return offset < 0 ? questions[questions.length - 1] : questions[0];
  }

  const nextIndex =
    (currentIndex + offset + questions.length) % questions.length;
  return questions[nextIndex];
}
