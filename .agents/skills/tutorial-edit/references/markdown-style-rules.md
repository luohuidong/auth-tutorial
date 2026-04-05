# 内容风格要求

## 图表

- 图表优先使用 Mermaid 绘制，Mermaid 无法表达时使用 ASCII 图
- 当使用 Mermaid 图时，使用默认的配色即可，因为要兼容 light mode 跟 dark mode 这两种模式的显示效果。

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

## 名词解释

如果专业名词需要解释，应该使用 details 标签包裹如：

```markdown
如果使用了 ECB 模式等对称加密模式存储密码，相同的明文会生成相同的密文，攻击者通过分析密文模式就能还原出大量原始密码。

::: details 什么是 ECB 模式？

在这里解释什么是 ECB 模式。

:::
```

## 其他

- 使用 `*` 强调文字的时候，如果强调文字左右都有其他文字，则需要使用空格将强调文字与其他文字隔开。例如，`理解 **认证** 的概念`，而不是 `理解**认证**的概念`。
