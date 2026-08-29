export const questionBankSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'questions'],
  properties: {
    schemaVersion: { const: 1 },
    source: { type: 'string', maxLength: 80 },
    promptVersion: { type: 'string', maxLength: 80 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    // 容器必须可解析；单题另行校验，才能把一批中的坏行报告为 PARTIAL 而不丢掉好行。
    questions: { type: 'array', items: true },
  },
} as const;

export const questionItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 500 },
    answer: { type: 'string' },
    category: { type: 'string', maxLength: 120 },
    difficulty: { enum: ['基础', '进阶', '困难'] },
    tags: { type: 'array', items: { type: 'string', maxLength: 80 } },
  },
} as const;
