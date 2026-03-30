# 认证服务整体设计

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 理解我们将要构建的 OIDC 授权服务器的整体架构，知道每个组件的作用
- 设计 OIDC 服务器所需的完整数据库模型（客户端表、授权码表、令牌表等）
- 规划 NestJS 项目的模块结构，让后续开发有清晰的目录依据
- 明确认证服务与业务系统之间的职责边界，避免职责混淆带来的架构腐化

### 重点与难点

**重点**：

- OIDC 授权服务器与业务应用之间的关系——它们之间如何通过标准协议交互
- 数据库模型背后的设计依据——为什么每张表要有这些字段，字段之间有什么约束
- 认证服务的职责边界——什么该放在认证服务里，什么应该留在业务服务里

**难点**：

- SSO Session 与业务应用本地 Session 的关系——两者并存，各自负责什么
- 授权码（Authorization Code）的一次性特性和安全设计
- RS256 密钥管理策略——私钥在哪里，公钥如何分发给各业务服务

## 从目标出发：我们要构建什么

在动手写代码之前，先从全局视角理解我们要构建的系统。

### 整体架构图

本教程将构建一个基于 OIDC（OpenID Connect）协议的集中式认证服务器，以及若干接入该认证服务的业务应用：

```mermaid
graph TB
    subgraph "用户的浏览器"
        Browser["🌐 浏览器"]
    end

    subgraph "认证服务（我们要构建的）"
        AuthServer["🏛️ OIDC 授权服务器\nauth.example.com"]
        AuthDB[("PostgreSQL\n用户 / 客户端 / 令牌")]
        AuthRedis[("Redis\nSSO Session / 授权码")]
    end

    subgraph "业务系统 A"
        AppA["💼 应用 A\napp-a.example.com"]
        AppASession[("Redis Session\n应用A本地会话")]
    end

    subgraph "业务系统 B"
        AppB["🛍️ 应用 B\napp-b.example.com"]
        AppBSession[("Redis Session\n应用B本地会话")]
    end

    subgraph "API 网关（后续模块）"
        Gateway["⬡ API Gateway\napi.example.com"]
    end

    Browser --> AuthServer
    Browser --> AppA
    Browser --> AppB
    AuthServer --> AuthDB
    AuthServer --> AuthRedis
    AppA --> AppASession
    AppB --> AppBSession
    AppA -->|"验证 ID Token\n获取用户信息"| AuthServer
    AppB -->|"验证 ID Token\n获取用户信息"| AuthServer
    Gateway -->|"验证 Access Token\n（公钥验证）"| AuthServer
```

这个架构有几个关键点需要理解：

**OIDC 授权服务器是整个认证体系的核心**。它知道所有用户的账号和密码，负责验证用户身份，并向可信的业务应用颁发身份证明（ID Token）。

**业务应用不存储密码**。应用 A 和应用 B 不知道用户的密码，它们只需要把登录流程委托给认证服务，然后接受认证服务颁发的凭证。

**每个应用有自己的本地 Session**。用户通过认证后，虽然认证服务的 SSO Session 记录了用户已登录，但每个业务应用也会建立自己的本地 Session。这个设计是 SSO 工作的核心机制——后续章节会详细讲解。

**API 网关验证 Access Token**。业务 API 不直接解析用户身份——API 网关拦截所有请求，验证请求携带的 Access Token 是否由认证服务签发，然后将用户信息注入请求头，让业务服务无需关心 Token 验证细节。

### 我们要实现的 OIDC 端点

OIDC 协议定义了一系列标准端点，我们需要逐一实现：

| 端点                                | 方法     | 功能描述                                 |
| ----------------------------------- | -------- | ---------------------------------------- |
| `/oauth/authorize`                  | GET      | 授权端点，启动 OAuth2/OIDC 流程          |
| `/oauth/token`                      | POST     | 令牌端点，用授权码换取令牌               |
| `/oauth/userinfo`                   | GET/POST | 用户信息端点，返回当前用户的 OIDC Claims |
| `/oauth/logout`                     | GET/POST | 登出端点，实现 RP-Initiated Logout       |
| `/.well-known/openid-configuration` | GET      | 发现文档，告知客户端各端点地址和能力     |
| `/.well-known/jwks.json`            | GET      | JWKS 端点，公开 RS256 公钥供其他服务验证 |

除了 OIDC 协议规定的端点，还需要若干业务端点：

| 端点                  | 功能描述                            |
| --------------------- | ----------------------------------- |
| `POST /auth/login`    | 处理用户在登录页提交的账号密码      |
| `POST /auth/consent`  | 处理用户在授权确认页的同意/拒绝操作 |
| `GET /clients`        | 管理端：查询客户端应用列表          |
| `POST /clients`       | 管理端：注册新的客户端应用          |
| `DELETE /clients/:id` | 管理端：删除客户端应用              |

## 认证服务与业务系统的职责边界

这是架构设计中最容易出错的地方。职责划分不清会导致两种常见问题：**认证服务过于臃肿**（把业务逻辑塞进来），或者**认证服务过于简单**（业务系统反向依赖认证服务的内部接口）。

### 认证服务应该做什么

认证服务只有一个核心职责：**回答"这个请求的发起者是谁"**。

具体来说，认证服务负责：

- **身份验证**：验证用户提交的凭据（密码、一次性验证码、生物特征等）
- **SSO Session 管理**：维护用户在认证服务侧的登录状态，支持免重复登录
- **令牌颁发**：向可信的客户端应用颁发 ID Token、Access Token、Refresh Token
- **令牌验证支持**：通过 UserInfo 端点和 JWKS 端点让其他服务能验证令牌
- **单点登出**：协调各业务应用的会话清理
- **客户端应用管理**：维护允许接入的客户端应用列表及其配置

认证服务 **不应该** 做的事情：

- **业务授权逻辑**：用户 A 能不能查看订单 B 的详情？这是业务逻辑，应该在业务服务里处理
- **角色权限管理**：RBAC 规则定义、角色授予/撤销——这些属于权限系统，应该独立部署
- **业务数据关联**：用户的购物车、用户的文章、用户的关注列表——这些在业务数据库里
- **发送业务通知**：注册欢迎邮件、密码找回邮件可以在认证服务发，但"你的订单已发货"由业务服务负责

### 为什么要严格划分职责

**理由一：可独立演化**

认证协议（OIDC、OAuth2）和业务需求的变化频率完全不同。如果认证服务里混入了业务逻辑，业务需求的频繁变更会影响到整个认证系统的稳定性。

**理由二：安全隔离**

认证服务存储了所有用户的密码哈希——这是最敏感的数据。将它与频繁变更的业务逻辑放在一起，意味着每次业务代码更新都有可能引入安全漏洞。

**理由三：可复用性**

一个职责清晰的认证服务可以为公司内所有系统提供服务——OA 系统、电商系统、内部工具都可以接入同一个认证服务，各自负责自己的业务授权。

### 认证与授权的协作模式

```mermaid
sequenceDiagram
    participant User as 用户
    participant AppA as 应用 A
    participant Auth as 认证服务
    participant BizAPI as 业务 API

    User->>AppA: 访问受保护页面
    AppA->>Auth: 重定向：你是谁？
    Auth-->>User: 登录页（输入账号密码）
    User->>Auth: 提交凭据
    Auth-->>AppA: 授权码 code
    AppA->>Auth: code 换取 ID Token + Access Token
    Auth-->>AppA: ID Token（证明用户身份）+ Access Token
    AppA->>BizAPI: 请求业务数据（携带 Access Token）
    Note over BizAPI: 验证 Token 签名 → 提取用户 ID
    Note over BizAPI: 检查用户权限（业务自己的 RBAC）
    BizAPI-->>AppA: 业务数据
```

这个流程清楚地展示了两个层次的关注点分离：

- **认证层（认证服务负责）**：证明"你是 user-123"
- **授权层（业务服务负责）**：决定 "user-123 能访问哪些资源"

## 数据库模型设计

认证服务需要以下几张数据库表。部分表（如 `users` 表）在模块二中已经建立，本节将在此基础上补充 OIDC 相关的表。

### 用户表（users）——扩展

模块二中已经定义了基础用户表，在 OIDC 场景下基本够用，无需大改。关键字段回顾：

```typescript
// 模块二已建立的 users 表核心字段
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }), // 第三方登录用户可为空
  emailVerified: boolean('email_verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### 客户端应用表（oauth_clients）

这是 OIDC 体系中最重要的表之一。每一个接入认证服务的业务应用，都需要在这里注册一条记录。

```typescript
export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 客户端标识符，公开的，相当于"用户名"
  clientId: varchar('client_id', { length: 100 }).notNull().unique(),

  // 客户端密钥的哈希值（对于机密客户端），相当于"密码"，不存明文
  clientSecretHash: varchar('client_secret_hash', { length: 255 }),

  // 客户端名称，显示在授权确认页
  clientName: varchar('client_name', { length: 255 }).notNull(),

  // 客户端类型：confidential（机密客户端，有后端）| public（公开客户端，纯前端）
  clientType: varchar('client_type', { length: 20 })
    .notNull()
    .default('confidential'),

  // 允许的回调地址白名单，JSON 数组格式
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull().default([]),

  // 允许的授权类型，如 ["authorization_code", "refresh_token"]
  grantTypes: jsonb('grant_types')
    .$type<string[]>()
    .notNull()
    .default(['authorization_code']),

  // 允许的 OIDC Scope，如 ["openid", "profile", "email"]
  allowedScopes: jsonb('allowed_scopes')
    .$type<string[]>()
    .notNull()
    .default(['openid']),

  // 是否需要用户手动确认授权（Consent）
  requireConsent: boolean('require_consent').default(true).notNull(),

  // Front-Channel Logout URI（用于 SLO）
  frontChannelLogoutUri: text('front_channel_logout_uri'),

  // Back-Channel Logout URI（用于 SLO）
  backChannelLogoutUri: text('back_channel_logout_uri'),

  // Post-logout Redirect URIs（登出后重定向地址白名单）
  postLogoutRedirectUris: jsonb('post_logout_redirect_uris')
    .$type<string[]>()
    .default([]),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});
```

**字段设计决策说明**：

**为什么 `clientSecretHash` 可以为空？** 公开客户端（如纯浏览器 SPA）没有安全的方式存储密钥，因此不应该有密钥——它们使用 PKCE 代替密钥来保证安全。只有机密客户端（有后端服务器的应用）才需要存储密钥。

**为什么 `redirectUris` 用 JSON 数组？** 一个客户端可能有多个合法的回调地址（开发环境、测试环境、生产环境分别一个），需要白名单验证。

**`requireConsent` 为什么可以设为 false？** 对于公司内部的自有应用，用户没必要每次都看到"应用 A 申请访问你的邮箱"这个确认页——这是公司内部系统，信任关系已经建立。但对于第三方应用，Consent 是保护用户隐私的必要步骤。

### 授权码表（auth_codes）

授权码是 OAuth2 Authorization Code Flow 的核心。它是认证服务颁发给业务应用的一张"兑换券"，有效期极短，且只能使用一次。

```typescript
export const authCodes = pgTable('auth_codes', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 授权码本身，随机生成的不可猜测字符串
  code: varchar('code', { length: 128 }).notNull().unique(),

  // 关联的客户端
  clientId: varchar('client_id', { length: 100 }).notNull(),

  // 授权的用户
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // 用户同意授权的 Scope
  scope: text('scope').notNull(),

  // 回调地址（必须与请求时的 redirect_uri 完全匹配）
  redirectUri: text('redirect_uri').notNull(),

  // PKCE code_challenge（公开客户端使用）
  codeChallenge: varchar('code_challenge', { length: 128 }),
  codeChallengeMethod: varchar('code_challenge_method', { length: 10 }),

  // 过期时间（通常是 10 分钟）
  expiresAt: timestamp('expires_at').notNull(),

  // 是否已使用（防止重放）
  used: boolean('used').default(false).notNull(),

  // 关联的 Nonce（OIDC 防重放）
  nonce: text('nonce'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

**关于授权码的安全设计**：

授权码的生命周期应该极短——RFC 6749 建议不超过 10 分钟，实际生产中通常设置为 5 分钟。这是因为授权码本身通过 URL 参数传递（出现在浏览器地址栏）——如果你的应用有第三方统计脚本，这些脚本可能通过 Referer 头或 URL 捕获到授权码。短生命周期把暴露窗口降到最低。

`used` 字段是防重放攻击的关键。授权码被使用一次后必须立即标记为 `used = true`，再次使用同一个授权码应该被拒绝，并且为了安全起见，还应该撤销该授权码已颁发的所有令牌。

在高并发场景下，"检查是否已使用"和"标记为已使用"这两个操作必须是原子的——否则攻击者可以在极短时间内发送两个请求同时使用同一个授权码。实现方式：使用数据库的 UPDATE SET used=true WHERE used=false 并检查 rowsAffected，或者对授权码的处理加分布式锁。

### 令牌表（oauth_tokens）

Access Token 和 Refresh Token 都存储在这张表里：

```typescript
export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 令牌类型：access_token | refresh_token
  tokenType: varchar('token_type', { length: 20 }).notNull(),

  // 令牌的哈希值（不存明文），对于 access_token 存 jti
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),

  // 关联的客户端
  clientId: varchar('client_id', { length: 100 }).notNull(),

  // 关联的用户
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // 授权的 Scope
  scope: text('scope').notNull(),

  // 过期时间
  expiresAt: timestamp('expires_at').notNull(),

  // 是否已被撤销
  revoked: boolean('revoked').default(false).notNull(),

  // 关联的设备/会话信息（可选，用于会话管理）
  sessionId: varchar('session_id', { length: 128 }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

**为什么存令牌的哈希而不是明文？** Access Token 本质上是一个凭证，如果数据库被攻破，攻击者不应该直接拿到所有有效的 Token。对 Token 做哈希（使用 SHA-256）后，即使数据库泄露，攻击者也需要对每个哈希值进行暴力破解，而现代的随机生成 Token（128 位以上熵值）几乎不可能被暴力破解。

**Access Token 是否需要存数据库？** 对于 JWT 格式的 Access Token（自包含，通过签名验证），理论上不需要存数据库。但如果要支持 Token 撤销（比如用户改密码后令所有 Token 失效），就需要一个存储层来记录已撤销的 Token（可以只存 jti 黑名单）。Refresh Token 由于生命周期长，必须存数据库。

### SSO Session 的存储设计

SSO Session 不存在 PostgreSQL 中，而是存在 Redis 里。原因是：

1. 读写频繁（每次受保护页面访问都要检查 SSO Session）
2. 需要自动过期（Redis 原生支持 TTL）
3. 需要快速查询（毫秒级响应）

Redis 中的 SSO Session 结构：

```plaintext
Key: sso:session:{sessionId}
Value: JSON
{
  "userId": "uuid...",
  "email": "user@example.com",
  "loginTime": 1700000000,
  "clients": ["client-id-a", "client-id-b"],  // 本次 SSO 会话中已登录的客户端
  "ipAddress": "1.2.3.4",
  "userAgent": "Mozilla/5.0..."
}
TTL: 7 days（根据安全策略调整）
```

`clients` 数组记录了用户通过这个 SSO Session 登录过哪些客户端应用——这个信息在单点登出（SLO）时非常关键：登出时需要通知所有这些应用清理本地 Session。

## NestJS 项目结构

### 模块划分

认证服务的 NestJS 项目将划分为以下模块：

```plaintext
src/
├── app.module.ts                # 根模块
├── main.ts                      # 应用入口
│
├── common/                      # 通用工具和基础设施
│   ├── decorators/              # 自定义装饰器
│   ├── filters/                 # 全局异常过滤器
│   ├── guards/                  # 守卫（认证守卫等）
│   ├── interceptors/            # 拦截器
│   └── pipes/                   # 管道（参数验证等）
│
├── config/                      # 配置模块
│   ├── config.module.ts
│   └── config.service.ts        # 类型安全的配置访问
│
├── database/                    # 数据库模块
│   ├── database.module.ts
│   ├── database.service.ts      # Drizzle 连接
│   └── schema/                  # Drizzle Schema 定义
│       ├── users.ts
│       ├── oauth-clients.ts
│       ├── auth-codes.ts
│       └── oauth-tokens.ts
│
├── redis/                       # Redis 模块
│   ├── redis.module.ts
│   └── redis.service.ts
│
├── keys/                        # 密钥管理模块
│   ├── keys.module.ts
│   └── keys.service.ts          # RS256 公私钥对管理
│
├── users/                       # 用户管理模块
│   ├── users.module.ts
│   ├── users.service.ts
│   └── users.controller.ts
│
├── auth/                        # 认证核心模块（登录/注销）
│   ├── auth.module.ts
│   ├── auth.service.ts
│   ├── auth.controller.ts       # /auth/login, /auth/logout
│   └── strategies/
│       └── local.strategy.ts    # Passport Local 策略
│
├── clients/                     # 客户端应用管理模块
│   ├── clients.module.ts
│   ├── clients.service.ts
│   └── clients.controller.ts
│
├── oauth/                       # OIDC/OAuth2 核心模块
│   ├── oauth.module.ts
│   ├── authorize/
│   │   ├── authorize.service.ts
│   │   └── authorize.controller.ts  # /oauth/authorize
│   ├── token/
│   │   ├── token.service.ts
│   │   └── token.controller.ts      # /oauth/token
│   ├── userinfo/
│   │   └── userinfo.controller.ts   # /oauth/userinfo
│   └── logout/
│       └── logout.controller.ts     # /oauth/logout
│
├── discovery/                   # OIDC 发现文档模块
│   ├── discovery.module.ts
│   └── discovery.controller.ts  # /.well-known/*
│
└── sso/                         # SSO Session 管理模块
    ├── sso.module.ts
    └── sso.service.ts           # SSO Session 的读写操作
```

### 为什么这样划分模块

**`oauth/` 与 `auth/` 分开**：`auth/` 专注于用户的实际认证动作（验证密码、建立 SSO Session），`oauth/` 专注于 OIDC/OAuth2 协议逻辑（授权码流程、令牌颁发）。两者职责不同，分开能让每个模块更内聚。

**`keys/` 单独成模块**：密钥管理是横切关注点，`oauth/` 模块签发 ID Token 需要私钥，`discovery/` 模块暴露 JWKS 需要公钥，单独的 `keys/` 模块可以统一管理密钥的加载、缓存和轮换逻辑。

**`sso/` 单独成模块**：SSO Session 的读写会在多个地方用到（授权端点检查 SSO Session、登出时清理 SSO Session、免登录流程更新 SSO Session），单独封装可以避免 Redis 操作的 key 命名和 TTL 逻辑散落在各处。

## 密钥管理策略

### RS256 密钥对的生成与存储

认证服务使用 RS256（RSA-SHA256）签名算法，需要一个 RSA 密钥对：

- **私钥**：用于签名 ID Token 和 Access Token，必须严格保密，只有认证服务持有
- **公钥**：用于验证 Token，通过 JWKS 端点公开，所有业务服务都可以获取

在生产环境中，私钥的存储方式有几种选择：

| 方案                     | 安全性 | 运维复杂度 | 适用场景        |
| ------------------------ | ------ | ---------- | --------------- |
| 环境变量（PEM 格式）     | 中     | 低         | 小团队/快速启动 |
| 密钥管理服务（KMS）      | 高     | 高         | 企业级生产环境  |
| Vault（HashiCorp Vault） | 高     | 中         | 中大型团队      |
| 挂载卷（K8s Secret）     | 中-高  | 中         | 容器化部署      |

本教程使用环境变量存储 PEM 格式私钥，这在开发和中小型生产环境中足够使用：

```typescript
// keys/keys.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, KeyObject } from 'crypto';

@Injectable()
export class KeysService {
  private privateKey: KeyObject;
  private publicKey: KeyObject;
  private kid: string; // 密钥 ID，用于 JWKS

  constructor(private readonly config: ConfigService) {
    const privatePem = this.config.getOrThrow<string>('JWT_PRIVATE_KEY');
    this.privateKey = createPrivateKey(privatePem);
    this.publicKey = createPublicKey(this.privateKey);
    this.kid = this.config.getOrThrow<string>('JWT_KEY_ID');
  }

  getPrivateKey(): KeyObject {
    return this.privateKey;
  }

  getPublicKey(): KeyObject {
    return this.publicKey;
  }

  getKid(): string {
    return this.kid;
  }

  // 以 JWK 格式导出公钥，供 JWKS 端点使用
  getPublicJwk(): object {
    const jwk = this.publicKey.export({ format: 'jwk' });
    return {
      ...jwk,
      use: 'sig',
      alg: 'RS256',
      kid: this.kid,
    };
  }
}
```

**关于 `kid`（密钥 ID）**：`kid` 是 JWT Header 中的一个字段，告诉验证方"这个 Token 是用哪个密钥签名的"。当你需要轮换密钥时（旧密钥签发的 Token 还没过期，但已经用新密钥签发新 Token 了），`kid` 让验证方能知道该用哪个公钥来验证，实现无感知密钥轮换。

### 密钥生成命令

```bash
# 生成 RSA 2048 位私钥
openssl genrsa -out private.pem 2048

# 从私钥提取公钥
openssl rsa -in private.pem -pubout -out public.pem

# 查看生成的私钥
cat private.pem
```

将私钥内容（整个 PEM 文件内容，包括首尾的 `-----BEGIN RSA PRIVATE KEY-----`）设置为环境变量：

```bash
# .env 文件（不要提交到 Git！）
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
...
-----END RSA PRIVATE KEY-----"
JWT_KEY_ID="key-2024-01"
```

注意：在 `.env` 文件中，多行字符串需要用引号包裹。

## 环境搭建与项目初始化

### 前置依赖

确保本地环境已安装：

- Node.js 20+
- pnpm 9+
- PostgreSQL 18（可用 Docker 启动）
- Redis 8（可用 Docker 启动）

### 创建 NestJS 项目

```bash
# 安装 NestJS CLI
npm install -g @nestjs/cli

# 创建认证服务项目
nest new auth-server --strict

cd auth-server

# 安装核心依赖
pnpm add @nestjs/config @nestjs/passport passport
pnpm add drizzle-orm pg
pnpm add ioredis
pnpm add zod@4
pnpm add argon2
pnpm add nanoid  # 生成安全的随机字符串

# 安装 JWT 相关（用于生成/验证 Token）
pnpm add jsonwebtoken
pnpm add -D @types/jsonwebtoken

# 安装开发依赖
pnpm add -D drizzle-kit @types/pg
```

### Docker 启动依赖服务

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: auth_user
      POSTGRES_PASSWORD: auth_pass
      POSTGRES_DB: auth_db
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:8
    ports:
      - '6379:6379'
    command: redis-server --requirepass redis_pass

volumes:
  postgres_data:
```

```bash
docker compose up -d
```

### 数据库迁移

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema/*.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

```bash
# 生成迁移文件
pnpm drizzle-kit generate

# 执行迁移
pnpm drizzle-kit migrate
```

## 常见问题与解决方案

### Q：认证服务应该由哪个团队维护？

**A**：认证服务是基础设施，应该由专门的平台/基础设施团队维护，而不是由各业务团队各自维护一套。如果团队规模小，可以指定一个人或小组负责，但要确保它的修改遵循严格的评审流程——认证服务的安全漏洞影响范围是整个公司的所有系统。

### Q：多个业务应用可以共用一个 client_id 吗？

**A**：绝对不行。每个独立的应用（每个不同的 redirect_uri）必须有独立的 `client_id`。共用 `client_id` 意味着无法区分是哪个应用在发起请求，无法精确管理权限范围，一个应用的密钥（`client_secret`）泄露会影响所有共用的应用。

### Q：授权码存在数据库还是 Redis？

**A**：推荐存在 Redis 中（带 TTL），而不是 PostgreSQL。理由：

1. 授权码生命周期极短（5-10 分钟），不需要持久化
2. Redis 的原子 GET+DEL 操作可以天然防止授权码重放（取出即删除，且原子执行）
3. 读写性能更好，不给数据库带来额外压力
4. 自动 TTL 无需额外的清理任务

如果使用 Redis：

```typescript
// 存储授权码（TTL 10 分钟）
await this.redis.setex(
  `auth_code:${code}`,
  600, // 10 分钟
  JSON.stringify(codeData)
);

// 原子地取出并删除（防重放）
const data = await this.redis.getdel(`auth_code:${code}`);
if (!data) throw new UnauthorizedException('授权码无效或已使用');
```

### Q：Access Token 要存数据库吗？

**A**：取决于是否需要即时撤销能力。

- **不需要即时撤销**：使用短生命周期的 JWT（15 分钟），过期后自然失效，不需要存储
- **需要即时撤销**（用户改密码、管理员封禁账号等）：存 Access Token 的 `jti` 到 Redis 黑名单（详见模块三《JWT 黑名单》章节）
- **Refresh Token 必须存**：生命周期长（7-30 天），必须持久化，并且支持撤销

### Q：私钥文件如何在多实例部署中共享？

**A**：不需要"共享"——所有实例使用相同的私钥即可。私钥通过环境变量或 K8s Secret 注入，所有实例启动时加载同一个私钥，签发的 Token 是完全等价的。但要注意：**私钥必须严格保密**，不能随着代码一起提交到 Git，不能出现在构建产物（Docker 镜像）中，应该在运行时通过环境变量注入。

## 本篇小结

本篇从宏观视角规划了整个 OIDC 授权服务器的设计方案。

**架构层面**，我们确定了认证服务与业务系统的职责边界：认证服务回答"你是谁"，业务系统决定"你能做什么"——这个边界一定要守住，否则认证服务会逐渐演变成一个难以维护的大泥球。

**数据模型层面**，我们设计了四张核心表：

- `users`（已有）：存储用户账号信息
- `oauth_clients`：注册可接入认证服务的应用
- `auth_codes`（建议用 Redis）：临时存储一次性授权码
- `oauth_tokens`：持久化 Refresh Token

**项目结构层面**，我们按照 OIDC 协议的职责划分了 NestJS 模块：`auth/` 负责实际的用户认证，`oauth/` 负责协议逻辑，`keys/` 负责密钥管理，`sso/` 负责 SSO Session。

**密钥管理层面**，我们为 RS256 签名算法确定了密钥存储和分发策略：私钥通过环境变量注入，公钥通过 JWKS 端点公开分发，用 `kid` 字段支持密钥轮换。

从下一篇开始，我们将逐步实现每个模块的具体代码，从最基础的客户端应用管理开始。
