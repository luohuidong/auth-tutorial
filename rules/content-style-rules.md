# 内容风格要求

## 图表

- 图表优先使用 Mermaid 绘制，Mermaid 无法表达时使用 ASCII 图

## 标题

- 标题前面不能添加分割线（`---` 或 `***`）
- 标题深度不超过 H4，且必须使用连续的标题级别（即不能直接从 H1 跳到 H4）

## 列表

- 列表周围必须有空行，如：

  ```markdown
  balabala：

  - list item 1
  - list item 2

  balabala
  ```

## Code Block

- 如果 code block 是纯文本内容，language 应该设置为 `plaintext`。
- code block 周围必须有空行，如：

  ````markdown
  balabala：

  ```plaintext
  some code here
  ```

  balabala
  ````

## 其他

- 使用 `*` 强调文字的时候，如果强调文字左右都有其他文字，则需要使用空格将强调文字与其他文字隔开。例如，`理解 **认证** 的概念`，而不是 `理解**认证**的概念`。
