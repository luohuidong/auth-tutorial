# ID Token 深度解析与 JWT 基础

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 掌握 ID Token 的完整验证流程（7个步骤）
- 理解 JWT 的三段结构（Header、Payload、Signature）
- 区分 HMAC 与 RSA 签名算法的适用场景
- 理解 RS256 的"自验证"特性及其安全含义

### 重点与难点

**重点**：

- JWT 三段结构的 Base64URL 编码细节
- RS256 签名的"自验证"——任何人用公钥都能验证，但只有私钥能签发
- ID Token 验证的 7 步顺序（不能乱）

**难点**：

- 为什么 `at_hash` 和 `c_hash` 能将 Token 绑定在一起
- 密钥轮换时，客户端如何平滑过渡（同时保留新旧公钥）

## JWT 基础补充

### 什么是 JWT

JWT（JSON Web Token）是一种紧凑的、URL-safe 的 JSON 结构，用于在各方之间安全传输信息。

一个 JWT 长这样：

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.
RSASSA-PKCS1-v1_5-SIGN(SHA-256(header), private-key)
```

由三段 Base64URL 编码的字符串组成，用 `.` 连接。

### JWT 的三段结构

#### 第一段：Header（头部）

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "2024-01"
}
```

- `alg`：签名算法（RS256、HS256、ES256 等）
- `typ`：Token 类型
- `kid`：Key ID，用于在 JWKS 中找到对应的公钥

#### 第二段：Payload（载荷）

```json
{
  "sub": "1234567890",
  "name": "John Doe",
  "admin": true,
  "iat": 1516239022,
  "exp": 1516242622
}
```

包含要传输的声明（Claims）。有三种类型的 Claims：

- **注册声明**（Registered）：`iss`（颁发者）、`sub`（主题）、`aud`（受众）、`exp`（过期时间）、`iat`（颁发时间）等
- **公共声明**（Public）：可自定义，但需避免与标准声明冲突
- **私有声明**（Private）：特定于某应用的声明

#### 第三段：Signature（签名）

对 `header.payload`（第一段.第二段）做签名，确保内容不可篡改。

### HMAC vs RSA

JWT 支持两种签名算法：

#### HMAC（对称加密）

```typescript
// 签名和验证用同一把密钥
const secret = 'my-secret-key';
const signature = HMAC_SHA256(base64url(header) + '.' + base64url(payload), secret);
```

- **优点**：计算快、签名验签同样快
- **缺点**：签发方和验证方必须共享同一把密钥——如果密钥泄露，任何人都能签发 Token
- **适用场景**：内部服务间的调用（两个服务都属于同一个团队）

#### RSA（ asymmetric 非对称）

```typescript
// 签名：用私钥
const privateKey = '-----BEGIN RSA PRIVATE KEY-----...';
const signature = RSASSA_PKCS1_V1_5_SIGN(SHA256(header + '.' + payload), privateKey);

// 验证：用公钥
const publicKey = '-----BEGIN RSA PUBLIC KEY-----...';
const isValid = RSASSA_PKCS1_V1_5_VERIFY(SHA256(header + '.' + payload), signature, publicKey);
```

- **优点**：私钥签发，公钥验证——私钥只在签发方（认证服务器）保存，公钥可以公开分发
- **适用场景**：第三方身份集成（Google 登录、GitHub 登录）——第三方用私钥签发 Token，你的服务用公钥验证

### RS256 的"自验证"特性

RS256 是 OIDC 的标准算法，它有一个独特的特性：**自验证（Self-Verifiable）**。

"自验证"的含义：Token 本身不包含任何秘密，任何人都可以用公钥验证它——但只有持有私钥的认证服务器能签发它。

这与 HMAC 不同：

| | HMAC（共享密钥） | RSA（公私钥对） |
|---|---|---|
| 签名方 | 持有共享密钥 | 持有私钥 |
| 验证方 | 持有共享密钥（相同） | 持有公钥（不同） |
| 密钥分发 | 必须安全传输给验证方 | 公钥可以公开分发，无需保密 |
| 泄露风险 | 任何有密钥的一方都能签发 | 只有私钥泄露才危险 |

OIDC 使用 RSA 的原因：在开放生态中（任何人开发的应用都可能集成 Google 登录），公钥可以写在代码或配置里，不需要安全传输给第三方。

### Base64URL 编码

JWT 使用一种特殊的 Base64URL 编码，与标准 Base64 有两个区别：

```
标准 Base64：     ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
Base64URL：       ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-
（+ 换成 -，/ 换成 _）

另外：标准 Base64 可能用 = 填充，Base64URL 省略 = 填充
```

这使得 JWT 可以安全地放在 URL 参数中（`+` 和 `/` 在 URL 中有特殊含义）。

## ID Token 验证：7 个步骤

客户端收到 ID Token 后，**必须**按以下步骤严格验证：

```typescript
async function validateIdToken(
  idToken: string,
  expectedNonce: string,
  clientId: string
): Promise<IdTokenPayload> {
  // 步骤1：解码 Header，获取 kid
  const { header } = decode(idToken, { complete: true }) as any;

  // 步骤2：用 kid 从 JWKS 端点获取公钥
  const publicKey = await getPublicKeyFromJwks(header.kid);

  // 步骤3：验证签名（不匹配则立即拒绝）
  const payload = verify(idToken, publicKey, {
    algorithms: ['RS256'], // 必须指定允许的算法，防止 alg:none 攻击
  }) as IdTokenPayload;

  // 步骤4：验证 iss（颁发者）
  if (payload.iss !== TRUSTED_ISSUER) {
    throw new Error('Invalid issuer');
  }

  // 步骤5：验证 aud（受众）包含本应用的 client_id
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) {
    throw new Error('Invalid audience');
  }

  // 步骤6：验证 exp（令牌未过期）
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('ID Token expired');
  }

  // 步骤7：验证 nonce（防止重放攻击）
  if (payload.nonce !== expectedNonce) {
    throw new Error('Invalid nonce - possible replay attack');
  }

  return payload;
}
```

**步骤顺序不能随意调换**：先验签名才能信任 Payload 中的 Claims；先验证 `exp` 才能避免使用过期 Token。

### 步骤详解

**步骤1-2：获取公钥**

从 ID Token Header 中提取 `kid`，用 `kid` 在 JWKS 端点找到对应公钥：

```typescript
async function getPublicKeyFromJwks(kid: string): Promise<KeyLike> {
  const jwks = createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'));
  return jwks({ kid });
}
```

**步骤3：验证签名**

用公钥验证 JWT 签名是否正确。如果签名被篡改，验证会失败。

**必须指定 `algorithms: ['RS256']`**：防止"alg: none"攻击（攻击者把 Header 的 `alg` 改成 `none`，绕过签名验证）。

**步骤4：验证 `iss`**

确保 Token 来自我们信任的认证服务器，而不是伪造的。

**步骤5：验证 `aud`**

ID Token 的 `aud` 是 `client_id`，验证 Token 是颁发给我们这个应用的，而不是其他应用。

**步骤6：验证 `exp`**

检查 Token 是否已过期。过期 Token 不应被接受。

**步骤7：验证 `nonce`**

`nonce` 在发起授权请求时生成，存在服务端 Session 中。收到 ID Token 后验证 `nonce` 与 Session 中存储的一致，确保这个 Token 是为当前浏览器会话签发的，不是重放的。

## at_hash 和 c_hash：Token 绑定

### at_hash（Access Token 绑定）

`at_hash` 是 ID Token 的一个声明，值是 Access Token 的哈希值（低16字节，Base64url 编码）。

验证 `at_hash` 的意义：确保这个 ID Token 和 Access Token 是配对的，防止攻击者用一个 ID Token 搭配另一个 Access Token（来自其他用户的授权）。

验证过程：

```typescript
// 1. 对 Access Token 做 SHA-256，取低16字节
// 2. Base64url 编码
// 3. 与 ID Token 中的 at_hash 比较
const expectedAtHash = base64url(sha256(accessToken).substring(0, 16));
if (payload.at_hash !== expectedAtHash) {
  throw new Error('at_hash mismatch');
}
```

### c_hash（Authorization Code 绑定）

类似地，`c_hash` 用于混合流（Hybrid Flow）中，将 Authorization Code 与 ID Token 绑定。

## 密钥轮换（Key Rotation）

认证服务器需要定期更换签名私钥（密钥轮换）。轮换时需要考虑：

### 旧 Token 仍在流通

旧 Token 用旧私钥签名，在过期前仍然有效。JWKS 端点必须同时保留新旧两把公钥，客户端用 `kid` 找到正确的那个。

### 客户端如何平滑过渡

1. 认证服务器签发新 Token 时使用新的 `kid`
2. JWKS 中同时包含新旧两个公钥（`kid` 不同）
3. 客户端看到新 `kid` 时，自动从 JWKS 获取新公钥
4. 旧 Token 自然过期后，旧公钥可以从 JWKS 中移除

建议：认证服务器在轮换后至少保留旧公钥 **24 小时**（或更长，取决于 Token 最大过期时间），确保所有客户端都有机会更新。

## 本篇小结

- **JWT = Header.Base64URL + Payload.Base64URL + Signature**，三段用 `.` 连接
- **HMAC**：对称加密，签发验证用同一密钥；**RSA**：非对称，私钥签发，公钥验证
- **RS256 是 OIDC 标准**：私钥只在认证服务器，公钥可公开分发，任何人都能验证
- **ID Token 验证 7 步**：Header → 签名 → iss → aud → exp → nonce（顺序不能乱）
- **`at_hash` 绑定 ID Token 和 Access Token**，`c_hash` 绑定 Authorization Code 和 ID Token
- **密钥轮换时**：JWKS 保留新旧两把公钥，`kid` 区分，客户端自动适配

## 下一步

现在你已经掌握了 OIDC 协议的核心知识。接下来我们将进入 **OIDC 服务器实现**，从客户端注册管理开始，一步步搭建自己的认证服务。
