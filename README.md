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

后端 Questions API 使用独立的 PostgreSQL 测试数据库，避免测试数据写入正式题库：

```bash
cd server
npm run test:e2e -- --runInBand
npm run build
```

E2E 测试通过 `server/.env.test` 中的 `TEST_DATABASE_URL` 连接测试库，覆盖正常导入、批内重复、库内重复、10 个并发重复请求、单题新增/修改和非法输入校验。每个测试结束后会清理 `Question` 数据并关闭应用连接；最近一次验证为 11 个用例全部通过。

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

## Windows Electron 桌面版

桌面版不是另一套项目。Electron 直接加载同一份 `src/` Vue 前端，因此网页端新增知识点或修改业务功能后，重新构建即可同时更新两端。

[下载 Windows 安装包](https://github.com/wqf12314-spec/question-bank-app/releases/download/v1.0.0/Knowledge-Navigator-Setup-1.0.0.exe)

```bash
# 开发模式
npm run desktop:dev

# 构建 Windows 安装包
npm run desktop:dist
```

安装包输出到 `release/`。NSIS 安装时会创建“知识航线”桌面快捷方式。桌面窗口默认使用紧凑悬浮布局并始终置顶，支持拖动、缩放、最小化、最大化和关闭；题库编辑、统计与数据迁移收在下方折叠区。

### 网页数据迁移到桌面

浏览器和 Electron 属于两个独立的安全存储空间，无法可靠地自动读取彼此的 `localStorage`。先在网页版页面底部展开“学习数据备份与迁移”并导出，再在桌面版下方“题库与设置 -> 数据”中导入。备份会包含全部 `localStorage` 键，包括练习记录、离线题库、收藏和后续新增的本地设置。

桌面版还会把这些数据同步到 `%APPDATA%\知识航线\learning-data.json`，应用重启和覆盖升级后会先恢复数据，再创建 Pinia Store。

## License

[MIT](LICENSE)
