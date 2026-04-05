# 教程整体规划

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 了解本系列教程最终要构建的系统及其核心能力
- 建立对整体架构的清晰认知，包括各个组成部分的职责
- 掌握各模块之间的依赖关系与推荐学习路径
- 在后续每一章学习时，都能清楚自己在整体拼图中完成了哪一块

### 重点与难点

本篇以概览为主，不涉及具体实现代码。目的是在你正式开始学习之前，建立整体视图，避免"只见树木，不见森林"。

## 我们要构建什么

一个 **集中式认证服务**，具备以下能力：

- 邮箱 + 密码登录（Session 认证、JWT 认证）
- 第三方登录：Google OAuth2、GitHub OAuth2、微信扫码登录
- Magic Link 邮箱登录（无密码）
- SSO 能力：多个业务应用共享同一套登录体系
- 单点登出（SLO）：退出一处，可选择退出所有地方
- MFA（多因素认证）：TOTP 支持

同时，我们将构建一个 **API 网关**，负责：

- 验证认证服务颁发的 JWT
- 权限检查
- 请求路由

以及一个 **前端客户端示例**，演示如何以纯前端模式或 BFF 模式接入认证服务。

## 整体架构图

```mermaid
flowchart TB
    subgraph Clients["客户端"]
        SPA["Web SPA\nReact + TanStack"]
        APP["移动 App\n（预留）"]
    end

    subgraph Gateway["API 网关 NestJS"]
        GW_JWT["JWT 验证中间件"]
        GW_RBAC["权限检查守卫"]
        GW_Route["路由转发"]
    end

    subgraph IdP["集中式认证服务（IdP）NestJS"]
        EP_Auth["授权端点\n/oauth/authorize"]
        EP_Token["Token 端点\n/oauth/token"]
        EP_User["用户信息端点\n/userinfo"]
        EP_JWKS["公钥端点\n/.well-known/jwks.json"]
        EP_Login["登录/注册接口\n/auth/login\n/auth/register"]
        EP_Social["第三方登录\n/auth/google\n/auth/github\n/auth/wechat"]
        EP_Magic["Magic Link\n/auth/magic-link"]
    end

    subgraph BizServices["业务服务（示例）"]
        SvcA["业务服务 A\n（OIDC 客户端）"]
        SvcB["业务服务 B\n（OIDC 客户端）"]
    end

    subgraph ThirdParty["第三方 IdP"]
        Google["Google"]
        GitHub["GitHub"]
        WeChat["微信开放平台"]
    end

    subgraph Storage["数据存储"]
        PG[("PostgreSQL 18\nDrizzle ORM\n用户/Token/Client 数据")]
        Redis[("Redis 8\nSSO Session\nRefresh Token\n验证码")]
    end

    SPA --> Gateway
    APP --> Gateway
    Gateway --> IdP
    Gateway --> BizServices
    IdP --> Google
    IdP --> GitHub
    IdP --> WeChat
    IdP --> PG
    IdP --> Redis
    BizServices -->|"验证 JWT\n获取公钥"| IdP

```

## 各模块的学习路径

```mermaid
flowchart LR
    M1["模块一\n认证基础\n📚 概念理解"]
    M2["模块二\nSession 认证\n🔐 基础实现"]
    M3["模块三\nJWT 认证\n🎫 Token 体系"]
    M4["模块四\nOIDC 服务器\n🏛️ 核心服务"]
    M5["模块五\n第三方登录\n🌐 联合身份"]
    M6["模块六\nAPI 网关\n🚪 流量管理"]
    M7["模块七\n客户端接入\n💻 前端集成"]
    M8["模块八\n高级安全\n🛡️ 生产就绪"]

    M1 --> M2
    M2 --> M3
    M3 --> M4
    M4 --> M5
    M4 --> M6
    M5 --> M7
    M6 --> M7
    M7 --> M8
```

**学习建议**：

- **模块一（认证基础）**：纯概念，不涉及代码。务必理解清楚再往后学
- **模块二（Session 认证）**：从最基础的认证方式入手，搭建项目脚手架
- **模块三（JWT 认证）**：理解 Token 体系，是后续 OIDC 的基础
- **模块四（OIDC 服务器）**：整个教程的核心，耗时最长，需要模块二和三的基础
- **模块五/六**：可以并行学习，分别是"谁能登录"和"登录后能做什么"
- **模块七**：在模块四/五/六完成后才能做完整的前后端联调

## 知识体系图

```mermaid
mindmap
  root((SSO 体系))
    问题
      多账号密码
      安全风险
      运维成本高
    核心角色
      IdP 身份提供者
        验证用户凭据
        颁发 Token
        管理 SSO Session
      SP 服务提供者
        信任 IdP 凭证
        管理本地 Session
        自行处理授权
    工作原理
      第一次登录
        重定向到 IdP
        输入密码
        颁发 Code
        Code 换 Token
        建立本地 Session
      免密访问
        携带 SSO Session Cookie
        IdP 直接发 Code
        无需再输密码
    实现协议
      SAML 企业级
      CAS 高校常见
      OIDC 互联网主流
    安全机制
      数字签名
      Authorization Code
      Back-channel 通信
      State 防 CSRF
```

## 本篇小结

本教程将从零构建一套完整的集中式认证体系：以 NestJS 实现的 IdP（身份提供者）作为核心，向上对接 API 网关和前端客户端，向外集成 Google、GitHub、微信等第三方登录。

各模块按层级递进——先打牢认证基础概念，再逐步实现 Session 认证、JWT、OIDC 服务器、第三方登录、API 网关、前端接入，最终覆盖 MFA 和生产部署等高级主题。每一章都是下一章的基础，在学习具体章节时，可以随时回到这里确认自己在整体路径中所处的位置。
