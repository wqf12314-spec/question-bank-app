const DAY_MS = 24 * 60 * 60 * 1000;

const INTERVALS = [1, 3, 7, 14, 30];

export function getNextReview(record, now = new Date()) {
  const base = new Date(now);
  const current = Number(record.reviewLevel || 0);
  const nextLevel =
    record.result === "correct"
      ? Math.min(current + 1, INTERVALS.length - 1)
      : 0;
  const intervalDays = INTERVALS[nextLevel];
  return {
    reviewLevel: nextLevel,
    intervalDays,
    nextReviewAt: new Date(
      base.getTime() + intervalDays * DAY_MS,
    ).toISOString(),
  };
}

export function explainReviewRecommendation(record) {
  if (record.result === "correct") return "本次掌握较好，逐步拉长复习间隔";
  if (record.result === "partial") return "部分掌握，短间隔复习巩固结构";
  return "未掌握，下一轮优先复习";
}

export function isReviewDue(record, now = new Date()) {
  return (
    !record.nextReviewAt ||
    new Date(record.nextReviewAt).getTime() <= new Date(now).getTime()
  );
}
