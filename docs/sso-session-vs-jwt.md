# Session 与 JWT：它们在 SSO 中各司什么职

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 在 SSO 架构图中，准确标注哪些链路使用 Session、哪些使用 JWT
- 理解 Session 和 JWT 的本质区别：服务器存状态 vs 客户端带状态
- 掌握为什么 IdP（认证服务）内部必须用 Session，以及它如何实现即时撤销
- 理解为什么 API 网关到业务服务之间用 JWT 更合适
- 清楚模块二（Session）和模块三（JWT）在整个 SSO 体系中的位置与分工

### 重点与难点

**重点**：

- 用一张 SSO 架构图标清 Session 和 JWT 的应用边界
- 理解「可撤销性」是 IdP 选 Session 的核心原因
- 理解 JWT 的「自包含」特性为何适合跨服务无状态验证

**难点**：

- 理解同一个用户登录后，实际上存在两层 Session：IdP 的 SSO Session 和各 SP 的本地 Session，它们各自独立管理
- 理解 JWT 在 SSO 中不是「替代 Session」，而是「在不同位置解决不同问题」

## 场景导入：学完技术却不知道用在哪里

很多读者学完模块二（Session 认证）和模块三（JWT 认证）后，会有一种奇怪的感觉：两个模块的技术细节都懂了，但不知道它们对应 SSO 架构中的哪一部分。

模块二写了完整的登录接口、Session 写入 Redis、Cookie 下发——但 SSO 场景下，IdP 的登录接口和普通网站的登录接口有什么区别？

模块三写了 Access Token + Refresh Token 的刷新流程——但这个流程跑在哪两个系统之间？网关？还是浏览器？

这种困惑很正常。大纲中缺少一篇把 Session 和 JWT 放回 SSO 架构中「定位」的文章。这正是本篇要解决的问题。

## SSO 架构全景图

下面这张图标注了 Session 和 JWT 在整个 SSO 体系中的实际位置。

```mermaid
sequenceDiagram
    participant Browser
    participant IdP as 认证服务（IdP）
    participant Redis as Redis（IdP侧）
    participant Gateway as API 网关
    participant SP as 业务服务（SP）
    participant SP_Redis as Redis（SP侧）

    Note over Browser,SP_Redis: Session 区域（可撤销）
    Note over Gateway,SP: JWT 区域（自包含）

    Browser->>IdP: 1. 登录（POST /auth/login）
    IdP->>Redis: 2. 创建 SSO Session
    IdP->>Browser: 3. 下发 SSO Session Cookie
    Browser->>IdP: 4. 访问受保护资源（带 Cookie）
    IdP->>Redis: 5. 查询 SSO Session
    IdP->>Browser: 6. 授权码（Code）

    Browser->>Gateway: 7. 用 Code 换 Token（经 SP）
    Gateway->>IdP: 8. Code 换 Token
    IdP->>Gateway: 9. Access Token（JWT） + Refresh Token
    Gateway->>SP_Redis: 10. SP 建立本地 Session（存用户ID）
    Gateway->>Browser: 11. SP Session Cookie

    Browser->>Gateway: 12. API 请求（带 SP Session Cookie）
    Gateway->>SP_Redis: 13. 验证 SP Session

    Browser->>Gateway: 14. API 请求（带 Authorization: Bearer JWT）
    Gateway->>Gateway: 15. 验签 JWT（无需查库）
```

图中两条虚线将架构划分为三个区域：

- **Session 区域（蓝色）**：IdP 内部的 SSO Session，存在 Redis 中，可撤销
- **JWT 区域（橙色）**：Access Token 在网关与 SP 之间流转，无状态验证
- **SP Session 区域（绿色）**：业务服务本地的 Session，存储用户身份标识

## 核心区别：服务器存状态 vs 客户端带状态

### Session：服务器存状态

用户登录后，服务器在 Redis 中创建一条 Session 记录，生成一串随机 Session ID，通过 Cookie 返回给浏览器。

```text
浏览器保存：Cookie: sid=abc123
Redis 存储：session:abc123 → { userId: "u_001", roles: ["user"], loginAt: ... }
```

后续请求，浏览器携带 Cookie，服务器通过 Session ID 从 Redis 查询用户信息。

**关键特性**：

- 服务器掌握完整状态，Session 创建后仍可随时撤销
- 用户改密码、账号被封禁 → 删除 Redis Session → 下次请求立即失效
- Session 过期时间由服务器控制，不依赖客户端时间

### JWT：客户端带状态

用户登录后，服务器用私钥签发一个 JWT，发送给客户端。服务器不存储任何东西。

```text
客户端保存：Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
JWT 内容：{ sub: "u_001", roles: ["user"], exp: 1743849600 }
服务器验证：拿公钥验签，确认未被篡改
```

**关键特性**：

- 服务器无状态，验证 JWT 不需要查库
- Token 一旦签发，在过期前无法撤销（除非加入黑名单）
- 可被任何持有公钥的服务独立验证，适合微服务架构

## 为什么 IdP 内部必须用 Session

IdP（认证服务）是整个 SSO 体系的核心，它必须能够**即时撤销**用户身份。

考虑以下场景：

| 场景 | 期望行为 | 只有 JWT 能否做到 |
|------|---------|----------------|
| 用户修改密码 | 立即失效所有已登录设备 | ❌ 需要额外黑名单 |
| 管理员封禁账号 | 立即生效 | ❌ 需要额外黑名单 |
| 用户主动注销 | 立即失效 | ❌ 需要额外黑名单 |
| 检测到账号异常 | 立即强制登出 | ❌ 需要额外黑名单 |

如果 IdP 内部用 JWT，撤销的唯一手段是维护一个 Redis 黑名单——这等于自己实现了一个 Session 系统，JWT 的「无状态」优势完全丧失。

所以 IdP 内部选择 Session：

- 撤销即删除 Redis 中的 Session 记录
- 用户下次携带 Cookie 来，Redis 查不到，立刻跳转登录页
- 实现简单，行为可预期

## 为什么网关到业务服务用 JWT

API 网关是所有流量的统一入口，它需要决定请求能否到达后端业务服务。

如果用 Session 验证：

```text
请求 → 网关 → 查询 Redis（Session 是否有效？） → 业务服务
```

问题来了：

1. **每次请求都要查 Redis**，网关成为性能瓶颈
2. **Redis 不可用时所有请求都失败**，无法做降级
3. **多实例网关需要 Session 共享**，架构复杂化

如果用 JWT 验证：

```text
请求 → 网关（拿公钥验签 JWT） → 业务服务
```

- 验签是 CPU 操作，无需网络 IO，极快
- 不依赖任何外部存储，无单点故障
- 多实例网关各自独立验签，水平扩展无压力

这就是为什么模块六（API 网关）用 JWT 作为主要验证手段，而不是 Session。

## 两层 Session：IdP Session 和 SP Session

还有一个容易混淆的点：同一个用户登录后，实际上存在**两层独立的 Session**。

```mermaid
flowchart LR
    subgraph IdPSide["IdP 侧（认证服务）"]
        IdPSession["SSO Session\n（Redis：用户是否在 IdP 登录过）"]
    end

    subgraph SPSide["SP 侧（业务服务）"]
        SPSession["本地 Session\n（Redis：用户是否在这个应用登录过）"]
    end

    Browser -->|"携带 SSO Cookie"| IdPSession
    Browser -->|"携带 SP Cookie"| SPSession
```

- **SSO Session**：IdP 维护，记录用户在 IdP 是否已登录，是「免密访问」的判断依据
- **SP Session**：各业务服务自己维护，记录用户在该应用中是否有有效会话

两层 Session 各自独立管理。用户在 IdP 登出，SP Session 不会自动销毁（这就是 SLO 需要专门实现的原因，模块四会详细讲解）。

## 技术选型一览

| 链路/场景 | 技术选型 | 原因 |
|---------|---------|------|
| IdP 内部 SSO Session | Session（Redis） | 需要即时撤销、用户感知登录状态 |
| SP 本地 Session | Session（Redis）或 JWT 皆可 | 取决于业务服务的设计偏好 |
| 网关 → 业务服务 验证 | JWT | 无状态、水平扩展、无需查库 |
| SP 之间微服务调用 | JWT | 自包含，接收方可直接验签 |
| 第三方应用验证身份 | ID Token（JWT，OIDC 标准） | SP 验证 IdP 签发的身份声明 |

## 模块二与模块三的学习指引

学完本篇后，你应该带着「这技术用在哪里」的问题去学习模块二和模块三：

**模块二（Session 认证）**解决的问题：

- IdP 如何验证用户密码并创建 SSO Session
- Session 的安全属性配置（HttpOnly、Secure、SameSite）
- Session 的生命周期管理（登录、注销、多设备、过期策略）
- 这些 Session 存在哪里？（Redis）

**模块三（JWT 认证）**解决的问题：

- Access Token 和 Refresh Token 的完整刷新流程
- JWT 的签名算法（RS256）和安全保障
- JWT 的撤销方案（黑名单、Token Version）
- 模块六的 API 网关如何用 JWT 验签

两者在模块四（OIDC 授权服务器）中汇合：

- 用户在 IdP 建立 SSO Session（模块二）
- IdP 签发 Access Token 和 ID Token 给 SP（模块三）
- SP 用 Access Token 访问网关和微服务（模块六）

## 本篇小结

本篇的核心结论只有一句话：**Session 和 JWT 不是替代关系，是在不同位置解决不同问题的互补关系。**

- IdP 内部用 Session，因为需要即时撤销
- 网关与业务服务之间用 JWT，因为需要无状态验证
- SP 本地可以用 Session，也可以用 JWT，取决于业务服务的设计风格

理解了这个分工，再去看模块二和模块三的技术细节，就不会再有「学完不知道用在哪」的困惑了。
