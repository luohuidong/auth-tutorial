# 教程大纲

## 模块一：直观认识

**目标**：先跑通 OIDC Flow，建立直观认识，再深入理论。

1. [认证 vs 授权](./auth-vs-authz.md)
   - 核心概念：认证（"你是谁"）vs 授权（"你能做什么"），401 vs 403
   - 简短版：保留原版的核心类比和关键概念

2. [OIDC 授权码 Flow 完整演示](./oidc-flow-demo.md) ⭐ 新增
   - 不写代码，用图文 + 抓包示例完整展示整个流程
   - 三方交互：浏览器、OIDC 服务器（IdP）、业务应用（SP）
   - 包含实际 HTTP 请求/响应片段

3. [OIDC 核心概念](./oidc-core-concepts.md) ⭐ 新增/合并
   - IdP、SP、Client 三个角色
   - ID Token vs Access Token 的用途
   - Scope 体系：`openid`、`profile`、`email`
   - 合并了原 sso-architecture.md 的部分内容

4. [SSO 是什么](./sso-what-is.md) ⭐ 新增/合并
   - 大学一卡通类比
   - 两层 Session：IdP 的 SSO Session vs SP 的本地 Session
   - 免登录的底层机制
   - SAML vs CAS vs OIDC 对比

## 模块二：OIDC 协议详解

**目标**：深入理解 OIDC 协议规范，为实现打下理论基础。

1. [OAuth2 协议详解](./oauth2-protocol.md)
   - 授权码模式、PKCE、state 防 CSRF
   - 四种授权模式对比
   - 委托授权的本质

2. [OIDC 协议详解](./oidc-protocol.md) ⭐ 精简
   - OAuth2 的认证盲区
   - ID Token 的结构与 Claims
   - 三种流程（授权码、混合、隐式）
   - Discovery Document、UserInfo 端点

3. [ID Token 深度解析与 JWT 基础](./oidc-id-token.md) ⭐ 新增
   - JWT 三段结构（Header、Payload、Signature）
   - HMAC vs RSA 签名算法
   - RS256 的"自验证"特性
   - ID Token 验证 7 步
   - `at_hash` 和 `c_hash` Token 绑定
   - 密钥轮换机制

4. [OIDC 标准端点](./oidc-standard-endpoints.md)
   - Discovery Document
   - JWKS 端点
   - UserInfo 端点

## 模块三：OIDC 服务器实现

**目标**：从零构建符合 OIDC 标准的授权服务器。

1. [认证服务整体设计](./oidc-server-design.md)
   - OIDC 架构图
   - 数据库模型（users、oauth_clients、oauth_tokens）
   - RS256 密钥管理
   - NestJS 模块结构

2. [客户端应用管理](./oidc-client-management.md)
   - 机密客户端 vs 公开客户端
   - PKCE 机制
   - Redirect URI 白名单

3. [授权端点与登录流程](./oidc-auth-endpoint.md)
   - `/oauth/authorize` 完整实现
   - SSO Session 检测
   - 授权码生成与存储
   - state 和 nonce 安全语义
   - prompt 参数处理

4. [Token 端点实现](./oidc-token-endpoint.md)
   - 客户端身份认证
   - ID Token 生成（RS256 签名）
   - Access Token + Refresh Token 生成
   - Refresh Token Rotation

5. [SSO Session 与免登录](./oidc-sso-session.md)
   - SSO Session 数据结构（Redis）
   - SsoService 完整实现
   - `prompt` 参数四种值
   - `max_age` 参数
   - 多应用登录传播机制

6. [单点登出（SLO）](./oidc-slo.md)
   - RP-Initiated Logout
   - Front-Channel Logout（iframe）
   - Back-Channel Logout（Logout Token）

## 模块四：客户端接入

**目标**：学习如何将 Web 应用接入 OIDC 服务器。

1. [SPA PKCE 授权码流程](./spa-pkce-flow.md) ⭐ 拆分/精简
   - 从 web-client-spa.md 拆分前半部分
   - PKCE 完整实现
   - Token 存储策略（分级存储）
   - 并发刷新防护

2. [SPA 静默认证与多标签页同步](./spa-silent-auth.md) ⭐ 拆分/精简
   - 从 web-client-spa.md 拆分后半部分
   - iframe 静默认证（`prompt=none`）
   - 第三方 Cookie 限制与替代方案
   - BroadcastChannel 多标签页同步

3. [Web 应用接入（BFF 模式）](./web-client-bff.md) ⭐ 精简
   - BFF 架构原理
   - HttpOnly Cookie + 服务端 Session
   - Token 代理与透明刷新
   - CSRF 防护

4. [前端集成实验](./spa-integration-experiment.md) ⭐ 新增
   - 手把手：创建 Vanilla TS SPA
   - 接入自己的 OIDC 服务器
   - 完整跑通 PKCE 授权码 Flow

## 模块五：API 网关集成

**目标**：理解 API 网关如何验证 Token、保护 API。

1. [API 网关设计](./api-gateway-design.md) ⭐ 精简
   - 网关职责边界
   - 请求处理管道（Middleware → Guard → Interceptor）
   - 无状态网关设计

2. [JWT 验证中间件](./jwt-middleware.md) ⭐ 精简
   - JWKS 公钥缓存（TTL 抖动）
   - 缓存击穿互斥锁（Mutex）
   - 熔断器（Circuit Breaker）
   - JWT 验证 7 步

3. [网关验证实验](./gateway-verification-experiment.md) ⭐ 新增
   - 手动解码 JWT
   - 从 JWKS 获取公钥
   - 用 Node.js 验签
   - 理解"无状态验证"

## 模块六：扩展内容（可选）

**目标**：生产级安全加固。

1. [密码安全基础](./password-security.md)
   - Argon2 哈希
   - 加盐机制
   - 密码泄露检测

2. [多因素认证（MFA）](./mfa.md)
   - TOTP 原理
   - MFA 注册与验证流程
   - 恢复码

3. [审计与安全监控](./audit-monitoring.md)
   - 审计日志设计
   - 攻击检测
   - 异常登录告警

4. [生产部署](./production-deployment.md)
   - Docker 多阶段构建
   - Kubernetes 部署
   - CI/CD + 健康检查

## 附录

- [教程概览](./tutorial-overview.md) — 整体架构与学习路径
- [本大纲](./tutorial-outline.md) — 你在这里
