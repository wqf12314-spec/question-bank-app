export type ReviewSuggestions = {
  category?: string;
  difficulty?: string;
  answer?: string;
  reasons: string[];
};

type SuggestionInput = {
  title: string;
  category: string;
  difficulty: string;
  answer: string;
};

/**
 * 本地确定性建议只减少审核录入量，不能替代人工判断或伪装成模型输出。
 */
export function createReviewSuggestions(
  question: SuggestionInput,
): ReviewSuggestions {
  const text = `${question.title} ${question.answer}`.toLocaleLowerCase();
  const reasons: string[] = [];
  const suggestions: ReviewSuggestions = { reasons };

  const category = classifyCategory(text);
  if (category && category !== question.category) {
    suggestions.category = category;
    reasons.push(`题干关键词匹配到${category}`);
  }

  const difficulty = classifyDifficulty(text);
  if (difficulty && difficulty !== question.difficulty) {
    suggestions.difficulty = difficulty;
    reasons.push(`题干复杂度关键词建议为${difficulty}`);
  }

  const normalizedAnswer = question.answer
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (normalizedAnswer && normalizedAnswer !== question.answer) {
    suggestions.answer = normalizedAnswer;
    reasons.push('答案仅做空白字符规范化，未自动改写内容');
  }
  return suggestions;
}

export function parseReviewSuggestions(value: string): ReviewSuggestions {
  try {
    const parsed = JSON.parse(value) as Partial<ReviewSuggestions>;
    return {
      ...(typeof parsed.category === 'string'
        ? { category: parsed.category }
        : {}),
      ...(typeof parsed.difficulty === 'string'
        ? { difficulty: parsed.difficulty }
        : {}),
      ...(typeof parsed.answer === 'string' ? { answer: parsed.answer } : {}),
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter(
            (reason): reason is string => typeof reason === 'string',
          )
        : [],
    };
  } catch {
    return { reasons: [] };
  }
}

function classifyCategory(text: string) {
  if (/(vue|react|css|html|组件|响应式|前端)/i.test(text)) return '前端';
  if (/(nest|node|express|接口|服务端|后端)/i.test(text)) return '后端';
  if (/(postgres|mysql|sql|数据库|索引|事务)/i.test(text)) return '数据库';
  if (/(redis|队列|缓存|消息)/i.test(text)) return '中间件';
  return undefined;
}

function classifyDifficulty(text: string) {
  if (/(并发|事务|一致性|分布式|性能|故障|回滚)/i.test(text)) return '进阶';
  if (/^(什么是|介绍|解释)/.test(text.trim())) return '基础';
  return undefined;
}
