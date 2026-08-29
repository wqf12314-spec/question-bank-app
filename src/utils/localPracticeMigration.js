const PRACTICE_RECORDS_KEY = "practice-records";
const DECISION_KEY_PREFIX = "knowledge-navigator:migration:v1";
const VALID_RESULTS = new Set(["wrong", "partial", "correct"]);
const VALID_MODES = new Set(["write", "view"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readRecords(storage) {
  const raw = storage.getItem(PRACTICE_RECORDS_KEY);
  if (!raw) return { records: [], unreadable: false };

  try {
    const records = JSON.parse(raw);
    return Array.isArray(records)
      ? { records, unreadable: false }
      : { records: [], unreadable: true };
  } catch {
    return { records: [], unreadable: true };
  }
}

function isMigratable(record) {
  const questionId = Number(record?.questionId);
  const mode = record?.mode ?? "write";
  return (
    Number.isInteger(questionId) &&
    questionId > 0 &&
    VALID_RESULTS.has(record?.result) &&
    VALID_MODES.has(mode)
  );
}

export function getLocalMigrationPreview(storage) {
  const { records, unreadable } = readRecords(storage);
  const migratableCount = records.filter(isMigratable).length;

  return {
    localCount: records.length,
    migratableCount,
    invalidCount: records.length - migratableCount,
    unreadable,
  };
}

export function prepareLocalPracticeRecords(
  storage,
  createUuid = () => crypto.randomUUID(),
) {
  const { records, unreadable } = readRecords(storage);
  if (unreadable) return { records: [], invalidCount: 0, unreadable: true };

  let changed = false;
  const prepared = [];

  records.forEach((record) => {
    if (!isMigratable(record)) return;

    let clientRequestId = record.clientRequestId;
    if (!UUID_PATTERN.test(clientRequestId ?? "")) {
      clientRequestId = UUID_PATTERN.test(record.id ?? "")
        ? record.id
        : createUuid();
      // 把新编号写回本地，网络失败后重试仍是同一次请求。
      record.clientRequestId = clientRequestId;
      changed = true;
    }

    const practicedAt = new Date(record.practicedAt);
    prepared.push({
      questionId: Number(record.questionId),
      clientRequestId,
      userAnswer: String(record.userAnswer ?? ""),
      result: record.result,
      mode: record.mode ?? "write",
      ...(Number.isNaN(practicedAt.getTime())
        ? {}
        : { practicedAt: practicedAt.toISOString() }),
    });
  });

  if (changed) {
    storage.setItem(PRACTICE_RECORDS_KEY, JSON.stringify(records));
  }

  return {
    records: prepared,
    invalidCount: records.length - prepared.length,
    unreadable: false,
  };
}

export function getMigrationDecision(storage, userId) {
  return storage.getItem(`${DECISION_KEY_PREFIX}:${userId}`);
}

export function markMigrationDecision(storage, userId, status) {
  storage.setItem(
    `${DECISION_KEY_PREFIX}:${userId}`,
    JSON.stringify({ status, decidedAt: new Date().toISOString() }),
  );
}
