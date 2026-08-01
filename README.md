# 前端面试题库

一个使用 Vue 3 构建的本地优先面试刷题工具，支持题库管理、筛选推荐、作答复习和学习统计。

在线体验：<https://wqf12314-spec.github.io/question-bank-app/>

## 功能

- 题目新增、编辑、删除和关键词搜索
- 分类、标签、难度与多标签筛选
- JSON 批量导入、示例题库下载和题库导出
- 首页按分类与标签随机推荐
- 作答模式与查看模式
- 文本输入与代码输入样式切换
- 自评、改评、重新作答和历史记录
- 分类、标签、掌握情况与刷题进度统计
- localStorage 本地持久化

## 技术栈

- Vue 3 Composition API
- Vue Router 4
- Pinia 2
- Vite 5
- Node.js Test Runner

## 本地运行

需要 Node.js 18 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开终端显示的本地地址。

## 测试与构建

```bash
npm test
npm run build
```

## 题库迁移

在题库管理页可以导出 JSON，也可以批量导入符合以下结构的数据：

```json
{
  "schemaVersion": 1,
  "questions": [
    {
      "title": "Vue 的 ref 是什么？",
      "answer": "ref 用于创建响应式值。",
      "category": "Vue",
      "tags": ["Vue", "响应式"],
      "difficulty": "基础"
    }
  ]
}
```

项目也提供了 [`public/sample-question-bank.json`](public/sample-question-bank.json) 作为示例。

## 数据说明

题目和练习记录保存在当前浏览器的 localStorage 中，不会自动上传到服务器。不同浏览器和设备之间的数据互不共享，请定期导出题库备份。

界面中的初音未来背景素材不包含在 MIT License 授权范围内，仅用于个人学习演示；公开转载或二次分发前请确认相关素材授权。

## 项目结构

```text
src/
├── components/  可复用组件
├── router/      页面路由
├── stores/      Pinia 数据状态与持久化
├── utils/       筛选、统计和数据迁移函数
└── views/       首页、题库、刷题和统计页面
```

## License

[MIT](LICENSE)
