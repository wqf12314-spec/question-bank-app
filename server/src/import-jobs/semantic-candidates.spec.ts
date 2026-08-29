import { findSemanticCandidates, titleSimilarity } from './semantic-candidates';

describe('semantic duplicate candidates', () => {
  it('只标记相似候选，不删除或改写输入题目', () => {
    const incoming = [{ title: 'Vue 响应式原理是什么' }];
    const existing = [{ id: 7, title: 'Vue 的响应式原理是什么？' }];
    const candidates = findSemanticCandidates(incoming, existing, 0.5);
    expect(candidates[0].matches[0].questionId).toBe(7);
    expect(incoming).toEqual([{ title: 'Vue 响应式原理是什么' }]);
    expect(titleSimilarity('完全不同', '数据库索引')).toBeLessThan(0.5);
  });
});
