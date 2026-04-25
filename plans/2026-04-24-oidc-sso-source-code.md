# OIDC SSO 示例代码实现计划

> **目标：** 在 `source/` 目录下实现四个可运行的示例项目，通过 pnpm workspace 管理，完整演示 OIDC SSO 认证流程。

**整体架构：**

```
Browser (SPA)
    │
    │ ① 重定向到 OIDC Server
    ▼
┌─────────────────────────────────────────┐
│  packages/oidc-server (NestJS)          │
│  - 授权端点 /oauth/authorize            │
│  - Token 端点 /oauth/token               │
│  - JWKS 端点 /.well-known/jwks.json     │
│  - Discovery /.well-known/openid-configuration │
│  - UserInfo /oauth/userinfo              │
│  - 登出 /oauth/logout                    │
│  - MySQL (Drizzle): users, oauth_clients │
│  - Redis: SSO Session, Refresh Token      │
└─────────────────────────────────────────┘
    │
    │ ② 授权码重定向回 SPA（浏览器）
    │    code=xxx&state=yyy
    ▼
┌─────────────────────────────────────────┐
│  packages/spa (Vanilla TS + Vite)        │
│  - 接收 OIDC 回调 /callback              │
│  - 将 code 转发给 Gateway                │
│  - 展示用户信息                          │
│  - 调用 Business Server API              │
└─────────────────────────────────────────┘
    │
    │ ③ POST /auth/callback { code }
    ▼
┌─────────────────────────────────────────┐
│  packages/api-gateway (NestJS)           │
│  - 授权码换 Token（机密客户端，持 secret）│
│  - Token 刷新                           │
│  - 验证 Access Token (JWKS 公钥)         │
│  - 路由转发至 Business Server            │
│  - 注入 x-user-id header                 │
│  - 管理 Refresh Token（存 Redis）         │
└─────────────────────────────────────────┘
    │
    │ ④ 业务请求（携带 Gateway Session）
    ▼
┌─────────────────────────────────────────┐
│  packages/business-server (NestJS)      │
│  - GET /api/profile                      │
│  - GET /api/orders                      │
│  - 从 header 读取用户身份（不再验 JWT）   │
└─────────────────────────────────────────┘
```

**技术栈：**
- pnpm workspace（根目录 `source/`）
- packages/oidc-server: NestJS + Drizzle ORM + MySQL + Redis
- packages/api-gateway: NestJS + Redis（无数据库）
- packages/business-server: NestJS（无数据库无 Redis）
- packages/spa: Vite + Vanilla TypeScript

---

## Task 0.5: 添加 docker-compose.yml 和环境变量模板

**Objective:** 提供 MySQL 和 Redis 的启动方式，以及各包的 .env.example

**Files:**
- Create: `source/docker-compose.yml`
- Create: `source/packages/oidc-server/.env.example`
- Create: `source/packages/api-gateway/.env.example`
- Create: `source/packages/business-server/.env.example`

**docker-compose.yml：**

```yaml
version: '3.8'
services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: oidc
    ports:
      - '3306:3306'
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

volumes:
  mysql_data:
  redis_data:
```

**oidc-server/.env.example：**

```env
DATABASE_URL=mysql://root:rootpassword@localhost:3306/oidc
REDIS_URL=redis://localhost:6379
PORT=3000
ISSUER_URL=http://localhost:3000

# Bootstrap 数据（pnpm bootstrap 时使用）
BOOTSTRAP_TEST_EMAIL=test@example.com
BOOTSTRAP_TEST_PASSWORD=password123
BOOTSTRAP_CLIENT_ID_SPA=spa-client
BOOTSTRAP_CLIENT_SECRET_SPA=spa-secret
BOOTSTRAP_CLIENT_ID_BFF=bff-client
BOOTSTRAP_CLIENT_SECRET_BFF=bff-secret
```

**api-gateway/.env.example：**

```env
PORT=3001
OIDC_ISSUER_URL=http://localhost:3000
OIDC_JWKS_URI=http://localhost:3000/.well-known/jwks.json
BUSINESS_SERVER_URL=http://localhost:3002
SESSION_SECRET=your-session-secret-min-32-chars
```

**business-server/.env.example：**

```env
PORT=3002
```

**Step: 验证**

Run: `cd source && docker compose up -d`
Expected: MySQL 和 Redis 启动成功

---

## Task 1: 搭建 pnpm workspace 骨架

**Objective:** 创建 pnpm workspace 结构，四个空包，根 workspace 配置

**Files:**
- Create: `source/pnpm-workspace.yaml`
- Create: `source/package.json`（root）
- Create: `source/packages/oidc-server/package.json`
- Create: `source/packages/api-gateway/package.json`
- Create: `source/packages/business-server/package.json`
- Create: `source/packages/spa/package.json`
- Create: `source/.gitignore`

**Step 1: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

**Step 2: 创建根 package.json**

```json
{
  "name": "auth-tutorial-source",
  "private": true,
  "scripts": {
    "dev:oidc": "pnpm --filter oidc-server dev",
    "dev:gateway": "pnpm --filter api-gateway dev",
    "dev:business": "pnpm --filter business-server dev",
    "dev:spa": "pnpm --filter spa dev"
  }
}
```

**Step 3: 各子包 package.json（最小配置，依赖暂不填）**

```json
// packages/oidc-server/package.json
{ "name": "oidc-server", "version": "1.0.0", "private": true }

// packages/api-gateway/package.json
{ "name": "api-gateway", "version": "1.0.0", "private": true }

// packages/business-server/package.json
{ "name": "business-server", "version": "1.0.0", "private": true }

// packages/spa/package.json
{ "name": "spa", "version": "1.0.0", "private": true }
```

**Step 4: 安装依赖并验证 workspace**

Run: `cd source && pnpm install`
Expected: workspace 结构就绪

---

## Task 2: 实现 OIDC Server — 数据库模型

**Objective:** 使用 Drizzle ORM 定义 MySQL 表结构：users、oauth_clients

**Files:**
- Create: `source/packages/oidc-server/src/db/schema.ts`
- Create: `source/packages/oidc-server/src/db/index.ts`
- Create: `source/packages/oidc-server/src/config.ts`
- Create: `source/packages/oidc-server/drizzle.config.ts`

**核心 Schema：**

```typescript
// users 表
export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// oauth_clients 表
export const oauthClients = mysqlTable('oauth_clients', {
  id: varchar('id', { length: 64 }).primaryKey(),         // client_id
  secretHash: varchar('secret_hash', { length: 255 }),    // null = 公开客户端
  name: varchar('name', { length: 128 }).notNull(),
  redirectUris: json('redirect_uris').$type<string[]>().notNull(),
  allowedScopes: json('allowed_scopes').$type<string[]>().notNull(),
  isPublic: boolean('is_public').notNull().default(false), // PKCE 客户端
  createdAt: timestamp('created_at').defaultNow(),
});
```

**Step: 验证**

Run: `pnpm --filter oidc-server generate` 生成 Drizzle migration 文件
Expected: migration 文件创建成功

---

## Task 3: 实现 OIDC Server — Redis SSO Session

**Objective:** 实现 SSO Session 的 Redis 存储，读写、过期、滑动刷新

**Files:**
- Create: `source/packages/oidc-server/src/sso/session.service.ts`
- Create: `source/packages/oidc-server/src/sso/index.ts`

**数据结构：**

```typescript
interface SsoSession {
  userId: string;
  email: string;
  loginTime: number;       // Unix timestamp，auth_time 来源
  authMethod: string;      // "pwd" | "mfa"
  previousSessionId?: string; // Session Fixation 防护
}

// Redis Key: sso:session:{sessionId}
// TTL: 7 days
```

**核心方法：**
- `createSession(userId, email)` → sessionId
- `getSession(sessionId)` → SsoSession | null
- `refreshTtl(sessionId)` → void（滑动过期）
- `destroySession(sessionId)` → SsoSession

**Step: 验证**

创建测试文件，mock Redis，验证 Session 创建和销毁逻辑

---

## Task 4: 实现 OIDC Server — Redis Refresh Token

**Objective:** 实现 Refresh Token 的 Redis 存储，支持 Rotation 和 Reuse 检测

**Files:**
- Create: `source/packages/oidc-server/src/token/refresh-token.service.ts`
- Create: `source/packages/oidc-server/src/token/index.ts`

**数据结构：**

```typescript
interface RefreshTokenRecord {
  tokenId: string;        // jti，JWT 中的唯一 ID
  userId: string;
  clientId: string;
  scope: string;
  families: string[];    // Token 家族，用于 rotation 检测
  version: number;        // 递增版本号
  createdAt: number;
}

// Redis Key: rt:{tokenId}
// 同时维护 user:{userId}:rt:family:{familyId} → 当前活跃版本号
```

**核心方法：**
- `createToken(userId, clientId, scope)` → { token, tokenId, familyId }
- `consumeToken(tokenId)` → 验证并标记已使用（rotation 检测）
- `revokeUserTokens(userId)` → 撤销用户所有 Refresh Token
- `revokeClientTokens(clientId)` → 撤销客户端所有 Refresh Token

**Step: 验证**

测试 Rotation（重复使用旧 Token 应被拒绝）和 Reuse 检测

---

## Task 5: 实现 OIDC Server — RS256 密钥对管理

**Objective:** 实现 RSA 密钥对的生成、存储、轮换支持

**Files:**
- Create: `source/packages/oidc-server/src/keys/keys.service.ts`
- Create: `source/packages/oidc-server/src/keys/index.ts`

**核心方法：**
- `getActiveKey()` → { kid, privateKey, publicKey }
- `getAllPublicKeys()` → JWKS 格式
- `sign(payload)` → JWT string
- `rotate()` → 生成新密钥对（JWKS 中保留旧公钥）

**Step: 验证**

调用 `getAllPublicKeys()`，确认返回标准 JWKS 格式

---

## Task 6: 实现 OIDC Server — 授权端点 /oauth/authorize

**Objective:** 实现完整的授权端点，支持 PKCE、SSO Session 检测、state/nonce

**Files:**
- Create: `source/packages/oidc-server/src/authorize/authorize.controller.ts`
- Create: `source/packages/oidc-server/src/authorize/authorize.service.ts`
- Create: `source/packages/oidc-server/src/authorize/index.ts`

**授权端点职责：**

```
GET /oauth/authorize?
  response_type=code&
  client_id=app_a&
  redirect_uri=https://app.example.com/callback&
  scope=openid profile email&
  state=xyz&
  code_challenge=E9Melhoa2OwvFrEMTJguCHa0Kx-tWfqQ2Z1m9_qYY7o&
  code_challenge_method=S256&
  prompt=none   // 可选
```

**核心逻辑：**

1. 验证 `client_id` 存在且 `redirect_uri` 在白名单
2. 验证 PKCE `code_challenge` 格式
3. 检查 `prompt` 参数：
   - `prompt=none`：有有效 SSO Session → 发 code；无 → 返回 `login_required` 错误
   - `prompt=login`：忽略 SSO Session，强制重新认证
   - 无 `prompt`：有 SSO Session → 直接发 code；无 → 跳转登录页
4. 用户认证后：
   - 生成 `code`（一次性授权码，存 Redis，TTL=10min）
   - 记录 `loggedInClients`
   - 重定向至 `redirect_uri?code=xxx&state=yyy`

**Step: 验证**

用 curl 模拟授权请求，验证参数校验逻辑

---

## Task 7: 实现 OIDC Server — 登录页面与登录接口

**Objective:** 提供简单登录页面，/auth/login 接口完成密码验证并建立 SSO Session

**Files:**
- Create: `source/packages/oidc-server/src/auth/login.controller.ts`
- Create: `source/packages/oidc-server/src/auth/login.service.ts`
- Create: `source/packages/oidc-server/src/auth/login.page.html`
- Create: `source/packages/oidc-server/src/auth/index.ts`

**登录流程（无 prompt=none 时）：**

```
用户访问 /oauth/authorize → 无 SSO Session → 重定向到 /auth/login?return_to=...
用户提交账号密码 → /auth/login → 验证密码 → 创建 SSO Session → 重定向回 /oauth/authorize
```

**Cookie 设置：**

```
Set-Cookie: sso_session={sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```

---

## Task 8: 实现 OIDC Server — Token 端点 /oauth/token

**Objective:** 实现 Token 端点，验证授权码或 Refresh Token，颁发 ID Token / Access Token / Refresh Token

**Files:**
- Create: `source/packages/oidc-server/src/token/token.controller.ts`
- Create: `source/packages/oidc-server/src/token/token.service.ts`

**Token 颁发逻辑：**

```typescript
async exchangeCode(code: string, codeVerifier: string, clientId: string) {
  // 1. 从 Redis 取出 auth_code（并删除，确保一次性）
  const authCode = await this.redis.get(`auth_code:${code}`);
  if (!authCode) throw new Error('invalid_grant');

  // 2. 验证 PKCE code_verifier
  const expected = base64url(sha256(codeVerifier));
  if (expected !== authCode.codeChallenge) throw new Error('invalid_grant');

  // 3. 验证 client_id 和 redirect_uri 匹配
  if (authCode.clientId !== clientId) throw new Error('invalid_grant');

  // 4. 生成 Token
  const { accessToken, idToken, refreshToken } = await this.issueTokens(authCode);
  return { access_token, id_token, refresh_token, token_type: 'Bearer', expires_in };
}
```

**ID Token Claims：**

```json
{
  "iss": "http://localhost:3000",
  "sub": "user-uuid",
  "aud": "client_id",
  "exp": now + 3600,
  "iat": now,
  "auth_time": 1700000000,
  "nonce": "from_auth_code",
  "at_hash": "access_token_hash"
}
```

**Step: 验证**

用授权码换 Token，验证返回的三种 Token 格式

---

## Task 9: 实现 OIDC Server — Discovery 和 JWKS 端点

**Objective:** 实现 /.well-known/openid-configuration 和 /.well-known/jwks.json

**Files:**
- Create: `source/packages/oidc-server/src/well-known/well-known.controller.ts`

**Discovery Document：**

```json
{
  "issuer": "http://localhost:3000",
  "authorization_endpoint": "http://localhost:3000/oauth/authorize",
  "token_endpoint": "http://localhost:3000/oauth/token",
  "userinfo_endpoint": "http://localhost:3000/oauth/userinfo",
  "jwks_uri": "http://localhost:3000/.well-known/jwks.json",
  "end_session_endpoint": "http://localhost:3000/oauth/logout",
  "scopes_supported": ["openid", "profile", "email"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
```

**JWKS 端点：**

返回 `keys.service.getAllPublicKeys()` 的结果

---

## Task 10: 实现 OIDC Server — UserInfo 和登出端点

**Objective:** 实现 /oauth/userinfo 和 /oauth/logout

**Files:**
- Create: `source/packages/oidc-server/src/userinfo/userinfo.controller.ts`
- Create: `source/packages/oidc-server/src/logout/logout.controller.ts`
- Create: `source/packages/oidc-server/src/logout/logout.service.ts`

**UserInfo 端点：**

- 从 Authorization Header 提取 Access Token
- 验证 Token 有效性和 scope
- 根据 scope 返回对应 Claims

**登出端点：**

```
GET /oauth/logout?id_token_hint=xxx&post_logout_redirect_uri=https://app.example.com
```

- 验证 `id_token_hint` 中的 `sub`
- 销毁 SSO Session
- 可选：发送 Back-Channel Logout 到已注册客户端

---

## Task 11: 实现 OIDC Server — Bootstrap 数据

**Objective:** 提供初始化脚本，创建测试用户和测试客户端

**Files:**
- Create: `source/packages/oidc-server/scripts/bootstrap.ts`

**数据：**

```typescript
// 测试用户
{ email: 'test@example.com', password: 'password123' }

// 测试客户端（SPA，公开客户端，PKCE）
{
  id: 'spa-client',
  name: 'Test SPA Client',
  isPublic: true,
  redirectUris: ['http://localhost:5173/callback'],
  allowedScopes: ['openid', 'profile', 'email']
}

// 测试客户端（BFF，机密客户端）
{
  id: 'bff-client',
  name: 'Test BFF Client',
  isPublic: false,
  secretHash: bcrypt('bff-secret'),  // 测试用，生产不要这样做
  redirectUris: ['http://localhost:3001/callback'],
  allowedScopes: ['openid', 'profile', 'email']
}
```

**Step: 验证**

运行 bootstrap 后，用测试账号走一遍完整 PKCE Flow

---

## Task 12: 实现 API Gateway — JWT 验证

**Objective:** 实现 Access Token 验证（从 JWKS 获取公钥验签），支持缓存

**Files:**
- Create: `source/packages/api-gateway/src/auth/jwt.service.ts`
- Create: `source/packages/api-gateway/src/auth/jwks.service.ts`
- Create: `source/packages/api-gateway/src/auth/index.ts`

**JWKS 缓存策略：**

```typescript
// 内存缓存 + TTL 抖动（防止缓存雪崩）
// 缓存击穿：Mutex 锁
interface JwksCache {
  keys: Map<string, KeyLike>;  // kid → 公钥
  expiresAt: number;
  fetching: Promise<KeyLike> | null;  // 防止并发击穿
}

async function getKey(kid: string): Promise<KeyLike> {
  // 1. 命中缓存 → 返回
  // 2. 未命中 → 请求 JWKS 端点
  // 3. 请求中 → 等待现有请求（Mutex）
}
```

**验证步骤：**

1. 从 Authorization Header 提取 Bearer Token
2. 解码 JWT Header，获取 `kid`
3. 从 JWKS 缓存获取公钥
4. 验证 RS256 签名
5. 验证 `iss`、`aud`、`exp`
6. 从 Payload 提取 `sub`、`email`、`roles`

**Step: 验证**

手动生成 JWT（用 OIDC Server 的私钥签），Gateway 能正确验证

---

## Task 13: 实现 API Gateway — 路由和 Guard

**Objective:** 实现 NestJS Guard，保护路由，注入身份 header

**Files:**
- Create: `source/packages/api-gateway/src/auth/jwt-auth.guard.ts`
- Create: `source/packages/api-gateway/src/auth/roles.decorator.ts`
- Create: `source/packages/api-gateway/src/auth/roles.guard.ts`
- Create: `source/packages/api-gateway/src/proxy/proxy.service.ts`
- Create: `source/packages/api-gateway/src/app.controller.ts`

**请求处理流程：**

```
Incoming Request
    │
    ├── JwtAuthGuard: 验证 Access Token
    │       │
    │       ├── 验证失败 → 401 Unauthorized
    │       └── 验证成功 → 从 JWT 提取 sub, email, roles
    │                          │
    │                          ▼
    ├── RolesGuard: 检查角色权限（可选）
    │       │
    │       ├── 权限不足 → 403 Forbidden
    │       └── 权限通过
    │                          │
    │                          ▼
    └── ProxyService: 转发请求到 Business Server
                    注入 x-user-id, x-user-email headers
```

**路由配置：**

```yaml
routes:
  - path: /api/profile
    target: http://localhost:3002
    auth: true
  - path: /api/orders
    target: http://localhost:3002
    auth: true
    roles: [user, admin]
  - path: /health
    target: http://localhost:3002
    auth: false
```

---

## Task 13.5: 实现 API Gateway — /auth/callback（授权码换 Token）

**Objective:** Gateway 接收 SPA 转发来的 code，用 client_secret（机密客户端）向 OIDC Server 换 Token，并建立 Gateway 自身的 Session

**Files:**
- Create: `source/packages/api-gateway/src/auth/callback.controller.ts`
- Modify: `source/packages/api-gateway/src/app.controller.ts`（添加 /auth/callback 路由）

**/auth/callback 实现：**

```typescript
// POST /auth/callback
// Body: { code: string, state: string }
// 行为：Gateway 用 code + client_secret 向 OIDC Server 换 Token
//      将 Refresh Token 存入 Redis Session
//      向浏览器下发 Gateway Session Cookie

async exchangeCode(code: string, state: string) {
  // 1. 构造 Token 请求，发给 OIDC Server 的 /oauth/token
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'http://localhost:3001/auth/callback',  // Gateway 的回调地址
    client_id: process.env.BFF_CLIENT_ID,
    client_secret: process.env.BFF_CLIENT_SECRET,
  });

  const response = await fetch(`${process.env.OIDC_ISSUER_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const tokens = await response.json();
  // tokens: { access_token, id_token, refresh_token, expires_in }

  // 2. 解码 ID Token，提取用户信息（sub, email, name）
  const idToken = decodeIdToken(tokens.id_token);

  // 3. 存入 Redis Session（Gateway 自己的 Session）
  const sessionId = await this.createSession({
    userId: idToken.sub,
    email: idToken.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  // 4. 下发 Session Cookie
  res.cookie('gateway_session', sessionId, {
    httpOnly: true,
    secure: false,  // 开发环境 false，生产 true
    sameSite: 'lax',
    maxAge: tokens.expires_in * 1000,
  });

  return { ok: true };
}
```

**Gateway Session 数据结构（Redis）：**

```typescript
interface GatewaySession {
  userId: string;
  email: string;
  accessToken: string;      // OIDC 颁发的 Access Token
  refreshToken: string;     // OIDC 颁发的 Refresh Token
  expiresAt: number;        // Access Token 过期时间
}

// Key: gw:session:{sessionId}
// TTL: 与 Access Token 过期时间一致
```

**Gateway 拦截业务请求时的 Session 刷新逻辑：**

```typescript
// 在 JwtAuthGuard 或 ProxyService 中，检查 Access Token 是否临期
async getValidAccessToken(sessionId: string): Promise<string> {
  const session = await this.getSession(sessionId);
  const now = Date.now();

  // Access Token 剩余有效期 < 5 分钟，主动刷新
  if (session.expiresAt - now < 5 * 60 * 1000) {
    const newTokens = await this.refreshTokens(session.refreshToken);
    session.accessToken = newTokens.access_token;
    session.refreshToken = newTokens.refresh_token;
    session.expiresAt = Date.now() + newTokens.expires_in * 1000;
    await this.saveSession(sessionId, session);
  }

  return session.accessToken;
}
```

**Step: 验证**

用浏览器走一遍完整 Flow：SPA 登录 → Gateway 收到 code → 换 Token 成功 → Session Cookie 下发 → 后续请求带 Cookie 正常

---

## Task 14: 实现 Business Server — 最小业务接口

**Objective:** 实现两个最小业务接口，演示如何从 header 读取身份

**Files:**
- Create: `source/packages/business-server/src/app.controller.ts`
- Create: `source/packages/business-server/src/user.decorator.ts`

**接口：**

```
GET /api/profile
X-User-Id: user-uuid
X-User-Email: test@example.com

Response: { "userId": "...", "email": "...", "registeredAt": "..." }


GET /api/orders
X-User-Id: user-uuid

Response: { "orders": [...] }
```

**代码风格：**

```typescript
@Get('profile')
getProfile(@Headers('x-user-id') userId: string) {
  return { userId, email: 'from-header', registeredAt: new Date().toISOString() };
}
```

**Step: 验证**

Gateway 开启时，请求 /api/profile，验证身份 header 正确注入

---

## Task 15: 实现 SPA — 接收 code 并转发给 Gateway

**Objective:** 实现回调页面，将授权码转发给 Gateway，由 Gateway 完成 Token 换取

**Files:**
- Create: `source/packages/spa/index.html`
- Create: `source/packages/spa/src/main.ts`
- Create: `source/packages/spa/src/callback.ts`（处理 code 转发）
- Create: `source/packages/spa/src/api.ts`（调用 Business Server）
- Create: `source/packages/spa/vite.config.ts`

**SPA 职责（极简）：**

```typescript
// callback.ts：解析 URL 中的 code，发给 Gateway
async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');

  if (!code) {
    document.body.innerHTML = '<p>No code received</p>';
    return;
  }

  // 将 code 发送给 Gateway，由 Gateway 用 client_secret 换 Token
  const response = await fetch('http://localhost:3001/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state }),
  });

  if (response.ok) {
    // Gateway 下发了自己的 Session Cookie，后续请求会自动携带
    window.location.href = '/';
  } else {
    document.body.innerHTML = '<p>Login failed</p>';
  }
}

handleCallback();
```

**SPA 不做的事（这些由 Gateway 处理）：**
- 不生成 PKCE verifier/challenge
- 不存储 Token
- 不刷新 Token
- 不直接访问 OIDC Token 端点

**SPA 做的事：**
- 构造 OIDC 授权 URL 并重定向
- 接收 callback，抓取 code，发给 Gateway
- 展示用户信息（从 Business Server 获取）
- 调用 Business Server API（携带 Gateway 的 Session Cookie）

**Step: 验证**

打开 SPA → 点击登录 → OIDC 登录 → 回调 SPA → Gateway 处理 code → 返回首页显示用户信息

---

## Task 16: 集成验证

**Objective:** 四个项目联调，跑通完整 Flow

**验证步骤：**

1. 启动 OIDC Server（pnpm dev:oidc）
2. 运行 bootstrap 创建测试数据
3. 启动 API Gateway（pnpm dev:gateway）
4. 启动 Business Server（pnpm dev:business）
5. 启动 SPA（pnpm dev:spa）
6. 浏览器访问 SPA，手动完成登录
7. 查看 ID Token 内容
8. 点击"获取订单"，验证通过 Gateway → Business Server 的完整调用

**预期结果：**

```
✅ 打开 SPA，点击"登录" → 重定向到 OIDC Server 登录页
✅ 输入测试账号密码 → OIDC Server 创建 SSO Session → 重定向回 SPA /callback
✅ SPA /callback 页面将 code 发给 Gateway
✅ Gateway 用 client_secret + code 换 Token 成功
✅ Gateway 下发 Session Cookie
✅ 回到 SPA 首页，显示用户信息（从 Business Server 获取）
✅ 点击"获取订单"，通过 Gateway → Business Server 成功返回
✅ Gateway 透明刷新 Token（Access Token 临期时自动刷新）
```
