import {
  createReviewSuggestions,
  parseReviewSuggestions,
} from './review-suggestions';

describe('review suggestions', () => {
  it('只生成可解释的本地分类、难度和答案格式建议', () => {
    expect(
      createReviewSuggestions({
        title: '如何处理 PostgreSQL 事务并发？',
        category: '未分类',
        difficulty: '基础',
        answer: '  使用事务。  \r\n',
      }),
    ).toEqual({
      category: '数据库',
      difficulty: '进阶',
      answer: '使用事务。',
      reasons: [
        '题干关键词匹配到数据库',
        '题干复杂度关键词建议为进阶',
        '答案仅做空白字符规范化，未自动改写内容',
      ],
    });
  });

  it('损坏的持久化建议返回空建议，审核页面仍可继续', () => {
    expect(parseReviewSuggestions('{not-json')).toEqual({ reasons: [] });
  });
});
