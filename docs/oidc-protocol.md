# OIDC 协议详解

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 理解 OAuth2 和 OIDC 的边界：OAuth2 解决授权，OIDC 解决认证
- 掌握 ID Token 的结构、Claims 语义
- 理解 OIDC 三种流程（授权码流、混合流、隐式流）的适用场景
- 理解 Discovery Document 和 JWKS 端点如何实现标准化集成
- 掌握 `nonce` 防 ID Token 重放攻击的机制

### 重点与难点

**重点**：

- ID Token 是什么，与 Access Token 的本质区别
- `nonce` 的作用：将 ID Token 与这一次浏览器会话绑定，防止重放
- UserInfo 端点 vs ID Token Claims——什么时候用哪个？

**难点**：

- `at_hash` 和 `c_hash`——Token 绑定机制的作用
- `auth_time` vs `iat`——认证时间与 Token 颁发时间的区别

## OAuth2 的认证盲区

### OAuth2 不是认证协议

OAuth2 的设计目标是"委托授权"——给应用 A 访问用户在服务 B 上某些资源的权限。Access Token 证明的是"持有者被授权访问某些资源"，它不是用户身份证明。

考虑这个场景：你的应用从 Google 拿到了一个 Access Token，用它调用 Google 的 `/userinfo` 接口，拿到了邮箱地址。你能确定这个 Access Token 是由用户本人在你的应用上授权产生的吗？

答案是：**在标准 OAuth2 下，你无法确定。**

假设有另一个应用 C（恶意的）也从同一个 Google 账户拿到了 Access Token，伪装成重定向请求发给你……这就是"OAuth2 身份混淆攻击"的变体。OAuth2 本来不是为认证设计的，用来做认证时存在安全隐患。

### OIDC 如何解决

OpenID Connect（OIDC）是架构在 OAuth2 之上的 **认证层**。它引入了一个新的 Token——**ID Token**，专门用来携带用户身份信息，并且有严格的验证规则，防止各种混淆攻击。

简单来说：

- **OAuth2**：你被授权进入 VIP 区域（Access Token 是门票）
- **OIDC**：你被授权进入 VIP 区域，门票上印了你的名字和照片（ID Token 包含身份信息）

## ID Token 深度解析

### ID Token 是一个 JWT

ID Token 是一个 JWT（JSON Web Token），由认证服务器用私钥签名，客户端用公钥验证。

一个典型的 ID Token 解码后长这样：

```json
{
  "iss": "https://accounts.google.com",
  "sub": "110169484474386276334",
  "aud": "client_abc123xyz",
  "exp": 1700005200,
  "iat": 1700001600,
  "auth_time": 1700001580,
  "nonce": "n-0S6_WzA2Mj",
  "at_hash": "MTIzNDU2Nzg5MDEyMzQ1Ng",
  "email": "ryan@example.com",
  "email_verified": true,
  "name": "Ryan Zhang",
  "picture": "https://lh3.googleusercontent.com/a/...",
  "locale": "zh-CN"
}
```

### 每个 Claim 的含义

**必须字段（所有 OIDC 实现都必须包含）**：

- `iss`（Issuer）：颁发者，即认证服务器的 URL。客户端验证这个字段，确保 Token 来自受信任的认证服务。
- `sub`（Subject）：用户在这个 `iss` 下的唯一标识符，稳定且不可变。**用 `sub` + `iss` 组合来唯一标识一个用户账号**。
- `aud`（Audience）：这个 Token 的目标受众，值为客户端的 `client_id`。客户端必须验证 `aud` 包含自己的 `client_id`，防止其他应用的 Token 被拿来冒充。
- `exp`（Expiration Time）：过期时间，Unix 时间戳。
- `iat`（Issued At）：颁发时间，Unix 时间戳。

**条件性字段**：

- `auth_time`：用户上一次 **实际认证**（输入密码或生物识别）的时间。与 `iat`（Token 颁发时间）不同——用户可能通过 SSO 免密登录（`iat` 是这次免密的时间，`auth_time` 是原始认证时间）。如果请求参数里有 `max_age`，则必须返回 `auth_time`。
- `nonce`：防重放攻击的随机值，详见下文。
- `at_hash`：Access Token 的哈希值（低16字节，Base64url 编码）。用于将 ID Token 与同时颁发的 Access Token 绑定，防止 Token 被替换。
- `c_hash`：Authorization Code 的哈希值，类似 `at_hash`，用于混合流程中绑定 code 和 ID Token。

### nonce：防 ID Token 重放

**重放攻击场景**：

假设攻击者截获了一个真实的 ID Token（从 HTTPS 请求日志中获取）。没有 nonce 的情况下，攻击者可以把这个 ID Token 提交给你的应用，冒充那个用户登录（只要 ID Token 还未过期）。

**nonce 机制**：

```typescript
// 1. 发起授权请求时，生成随机 nonce，存入 Session
const nonce = randomBytes(32).toString('hex');
req.session.oidcNonce = nonce;

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` + `...&nonce=${nonce}`;

// 2. 授权服务器收到 nonce → 写入 ID Token 的 nonce Claim
// 3. 客户端收到 ID Token 后，验证 nonce 是否与 Session 中存储的一致
const payload = await validateIdToken(idToken, req.session.oidcNonce, CLIENT_ID);
delete req.session.oidcNonce; // 清除，防止同一 nonce 被多次使用
```

nonce 将 ID Token 锁定到特定的浏览器 Session——即使攻击者截获了 ID Token，因为没有对应的 Session nonce，他无法在另一个登录流程中使用它。

## OIDC 的三种授权流程

OIDC 扩展了 OAuth2 的 `response_type` 参数，支持三种流程：

### 授权码流（Authorization Code Flow）

`response_type=code`

与标准 OAuth2 授权码流相同，但在 Token 端点同时返回 ID Token 和 Access Token。

**适用场景**：有服务的 Web 应用（BFF 模式）。这是 **生产推荐** 的流程，安全性最高。

### 混合流（Hybrid Flow）

`response_type=code token` 或 `response_type=code id_token` 或 `response_type=code id_token token`

授权端点立即返回 code 和部分 Token，Token 端点再返回完整的 Token。

**适用场景**：某些特定需求（如前端立即需要 ID Token，但 Access Token 仍走后端通道）。实际生产中用得很少。

### 隐式流（Implicit Flow）——已过时

`response_type=id_token` 或 `response_type=id_token token`

直接在授权端点返回 Token，不走授权码换 Token 的步骤。

**不推荐使用**：和 OAuth2 的隐式模式一样，Token 暴露在 URL 里。已被 OAuth 2.1 草案废弃。SPA 应改用带 PKCE 的授权码流。

## OIDC 标准端点

### Discovery Document

```
/.well-known/openid-configuration
```

这是一个 JSON 文档，描述认证服务器的所有能力和端点地址：

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/oauth/authorize",
  "token_endpoint": "https://auth.example.com/oauth/token",
  "userinfo_endpoint": "https://auth.example.com/oauth/userinfo",
  "jwks_uri": "https://auth.example.com/.well-known/jwks.json",
  "end_session_endpoint": "https://auth.example.com/oauth/logout",
  "scopes_supported": ["openid", "profile", "email"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
```

有了 Discovery，客户端只需要知道 `issuer` URL，就能自动发现所有端点，极大降低了集成成本。

### JWKS 端点

```
/.well-known/jwks.json
```

公钥集合端点，客户端从这里获取验证 ID Token 签名的公钥：

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "2024-01",
      "n": "0vx7agoebGcQSuuPiLJXZptN9...",
      "e": "AQAB"
    }
  ]
}
```

`kid`（Key ID）用于在 JWKS 中找到对应的公钥进行验签。当认证服务器进行密钥轮换时，JWKS 可以同时包含多个公钥。

### UserInfo 端点

```typescript
const response = await fetch('https://auth.example.com/oauth/userinfo', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const userInfo = await response.json();
// { sub, name, email, email_verified, picture }
```

### ID Token Claims vs UserInfo 的取舍

| 特征 | ID Token Claims | UserInfo 端点 |
|---|---|---|
| 传输方式 | 包含在 Token 里，无需额外请求 | 需要额外的 HTTP 请求 |
| 数据时效性 | Token 颁发时的快照（历史数据） | 实时读取（最新数据） |
| 包含的信息量 | 通常只有基础信息 | 可以按 scope 返回更丰富的信息 |
| 适用场景 | 认证完成时快速获取用户身份 | 需要最新用户信息（如头像已更改） |

**推荐实践**：

- 用 ID Token 的 `sub` 作为用户唯一标识
- 用 UserInfo 端点获取最新的 `name`、`email`、`picture` 等显示信息

## OIDC 的 Scope 体系

OIDC 定义了几个标准 Scope，控制 ID Token 和 UserInfo 中返回哪些 Claims：

| Scope | 对应的 Claims |
|---|---|
| `openid` | `sub`（必须，声明这是 OIDC 请求） |
| `profile` | `name`, `given_name`, `family_name`, `picture`, `locale` |
| `email` | `email`, `email_verified` |
| `phone` | `phone_number`, `phone_number_verified` |

**重要提示**：`openid` Scope 是必须的——否则请求是普通 OAuth2 请求，不是 OIDC 请求，授权服务器不会返回 ID Token。

## 常见问题

### Q：ID Token 可以用来调用资源服务器的 API 吗？

**A**：不应该。ID Token 是给 **客户端应用** 验证用户身份用的，`aud`（受众）是 `client_id`。调用 API 应该用 Access Token，`aud` 是 API 的地址或标识符。

### Q：同一个 Google 账户，在应用 A 和应用 B 登录，`sub` 值一样吗？

**A**：同一个 Google 账户在不同 `client_id` 下的 `sub` 是 **相同的**（都是 Google User ID）。在你自己搭建的 OIDC 服务器里，`sub` 就是你数据库里的 `userId`。

## 本篇小结

- **OAuth2 是授权协议，OIDC 是认证协议**——OIDC 在 OAuth2 基础上增加 ID Token 来证明用户身份
- **ID Token 是 JWT**，包含 `iss`、`sub`、`aud`、`exp`、`iat`、`nonce` 等标准 Claims
- **`nonce` 将 ID Token 绑定到特定浏览器 Session**，防止重放攻击
- **`sub` + `iss` 组合唯一标识用户**，是账号关联的关键字段
- **Discovery Document** 使 OIDC 服务器可以被自动发现，客户端只需知道 `issuer` URL

## 下一步

下一篇我们将深入 **ID Token 的验证细节**，并补充 JWT 的基础知识（结构、签名算法、RS256 自验证）。
