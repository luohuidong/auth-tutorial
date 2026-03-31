# 教程目录结构

通过下面的目录结构，可以快速定位到对应章节的教程内容以及相关的其他内容：

```textplain
.
├── assets
│   └── auth-vs-authz # 章节文件夹，名称与章节名称一致，用于存放对应章节的相关内容
│       └── code # 该目录存放章节对应的可执行示例代码
├── docs
│   ├── auth-vs-authz.md # 章节内容
│   ├── tutorial-overview # 教程概览
│   └── tutorial-outline.md # 教程大纲，包含模块划分和章节列表
└── rules # 该目录用于存放教程在编写时需要遵守的所有规则
```

- 对应章节的教程，存放在根目录 `docs` 文件夹下。例如 `auth-vs-authz` 章节教程存放在 `docs/auth-vs-authz.md` 中。
- 其他对应章节的相关内容，例如章节教程摘要、章节对应的可执行代码等，存放在 `assets` 文件夹下的对应章节文件夹中。例如 `auth-vs-authz` 章节的相关内容存放在 `assets/auth-vs-authz/` 文件夹下。
