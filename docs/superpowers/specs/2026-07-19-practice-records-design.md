# 刷题记录与重新作答设计

## 目标

让用户完成“自己作答 -> 查看参考答案 -> 自评 -> 保存历史”的闭环，同时允许修正本次评价，并明确区分“修改当前记录”和“重新做一遍”。

## 本阶段范围

- A 模式：先写自己的答案，再查看参考答案并自评。
- 三种评价：`wrong`、`partial`、`correct`。
- 首次评价新增记录。
- 本次作答内再次评价时更新同一条记录。
- 用户点击“重新作答”后，下一次评价新增记录。
- 用户主动点击“下一题”，不在保存后自动跳转。
- 当前题目的历史记录按时间倒序展示。
- 练习记录保存到 `localStorage`。

本阶段不实现 B 模式、AI 自动评分、间隔重复算法和跨设备同步。

## 数据结构

```js
{
  id: "uuid",
  questionId: "对应题目的 id",
  userAnswer: "用户本次填写的答案",
  result: "wrong | partial | correct",
  practicedAt: "首次保存时间 ISO 字符串",
  updatedAt: "最后修改时间 ISO 字符串"
}
```

`questionId` 关联 `questions.id`。现有题目 id 可能是数字或 UUID 字符串，保存记录时统一使用 `String(question.id)`，查找历史时也转换成字符串比较。同一道题可以有多条记录，每条记录代表一次明确开始的作答。

## 状态模型

`PracticePage.vue` 增加：

```js
const currentRecordId = ref(null);
```

状态含义：

```text
currentRecordId === null
-> 当前作答尚未保存
-> 点击评价时新增记录

currentRecordId 有 id
-> 当前作答已经保存
-> 再次点击评价时更新同一条记录
```

不通过答案内容或时间间隔猜测是否重新作答。相同答案可能来自新的思考，不同答案也可能只是修改当前答案；只有明确点击“重新作答”才开始新记录。

## 用户流程

### 首次保存

```text
填写“我的答案”
-> 查看参考答案
-> 点击评价
-> addRecord 新增记录
-> currentRecordId 保存新记录 id
-> 页面显示“已记录：评价名称”
-> 停留在当前题目
```

允许空答案保存，以支持完全不会时直接查看答案并标记“完全不对”。

### 修改本次评价

```text
currentRecordId 已存在
-> 用户修改答案或改点评价
-> updateRecord 更新同一条记录
-> 更新 userAnswer、result、updatedAt
-> practicedAt 保持不变
```

### 重新作答

```text
点击“重新作答”
-> userAnswer 清空
-> 参考答案隐藏
-> currentRecordId 设为 null
-> 成功提示清空
-> 下一次点击评价时新增记录
```

### 下一题

```text
点击“下一题”
-> 找到当前题目在 questions 数组中的位置
-> 选择下一项，末尾时回到第一项
-> 更新路由 query.questionId
-> 重置本次作答状态
```

## Store 设计

`src/stores/practice.js` 负责：

```js
records
addRecord(record)
updateRecord(id, nextValues)
loadRecords()
```

页面调用 `addRecord` 时只传 `questionId`、`userAnswer` 和 `result`。Store 负责生成 `id`、`practicedAt`、`updatedAt`，并返回新增记录的 `id`，供页面写入 `currentRecordId`。`updateRecord` 根据记录 `id` 更新，不使用数组位置作为跨层接口。

Store 使用 `practice-records` 作为 `localStorage` 键。读取失败时回退为空数组，避免损坏数据让页面无法启动。

## 历史记录

页面只显示当前题目的记录：

```js
records
  .filter((record) => record.questionId === String(currentQuestion.id))
  .slice()
  .sort((a, b) => new Date(b.practicedAt) - new Date(a.practicedAt));
```

`slice()` 先复制数组，避免 `sort()` 原地修改 Store 中的记录顺序。

每条历史显示：练习时间、评价中文名称和当时的用户答案。最新记录在最上方。

## 错误与边界

- 题目不存在时不允许保存记录。
- `result` 不属于三个允许值时拒绝写入。
- 当前记录被删除或找不到时，更新操作返回失败，页面不伪造成功提示。
- 题库只有一道题时，“下一题”仍停留在该题，但会重置为新一次作答。
- localStorage 内容损坏时加载空记录，并保留可恢复的页面状态。

## 测试

Store 测试：

- `addRecord` 追加记录并返回 id。
- `updateRecord` 修改同一条记录，不增加数组长度。
- 记录写入 localStorage，创建新 Store 后可以恢复。
- 非法评价被拒绝。

页面行为测试：

- 首次评价新增记录。
- 改点评价更新当前记录。
- 重新作答后再次评价新增第二条记录。
- 历史记录按 `practicedAt` 倒序显示。
- 下一题重置作答状态并更新路由参数。

## 学习重点

必须掌握：

- `ref(null)` 表示当前没有已保存记录。
- `if / else` 区分新增和更新。
- `questionId` 关联题目，`record.id` 识别记录本身。
- `filter + slice + sort` 生成倒序历史，不修改原数组。
- 页面负责交互状态，Store 负责记录数据和持久化。

先看懂：

- `crypto.randomUUID()` 生成记录 id。
- 路由 query 更新下一题。
- localStorage 损坏时的错误恢复。
