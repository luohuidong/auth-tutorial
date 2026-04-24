# 网关验证实验

## 本篇导读

### 实验目标

本实验让你**手动验证一个 Access Token**，亲身体验 API 网关是如何验证 JWT 的。

### 前提条件

- 完成模块三的 OIDC 服务器实现
- 完成模块四的客户端集成实验（获取到一个有效的 Access Token）
- Access Token 未过期

### 实验验收标准

实验完成后，你能：

1. 手动从 Access Token 中解码出 Header 和 Payload
2. 从 OIDC 服务器的 JWKS 端点获取公钥
3. 验证 Token 签名是否有效
4. 理解网关为什么可以"无状态"验证 Token

## 实验步骤

### 第一步：获取一个 Access Token

从上一个实验中，或者通过以下方式获取一个有效的 Access Token：

```bash
# 假设你的 OIDC 服务器运行在 localhost:3000
# 先获取授权码（手动构造授权 URL）
open "http://localhost:3000/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:5173/callback&scope=openid%20profile%20email"

# 用拿到的 code 换取 token
curl -X POST http://localhost:3000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=YOUR_CODE&client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:5173/callback&code_verifier=YOUR_CODE_VERIFIER"

# 复制返回的 access_token
```

### 第二步：解码 Access Token

Access Token 是一个 JWT，结构为 `header.payload.signature`，用 `.` 分隔。

1. 打开 [https://jwt.io](https://jwt.io)
2. 在左侧输入 Access Token 的值
3. 观察右侧自动解码出的 Header 和 Payload

**记录下来**：
- `alg`（算法）：应该是 `RS256`
- `kid`（密钥 ID）：记录下来，下一步用

### 第三步：获取 JWKS 公钥

```bash
curl http://localhost:3000/.well-known/jwks.json
```

你会收到类似这样的响应：

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "2026-04-01",
      "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbW...",
      "e": "AQAB"
    }
  ]
}
```

找到与 Token Header 中 `kid` 匹配的那把公钥。

### 第四步：用 Node.js 验证签名

现在我们用代码验证这个 Token 的签名是有效的：

```typescript
// verify-token.ts
import { createRemoteJWKSet, jwtVerify, importJWK, JWK } from 'jose';

const ACCESS_TOKEN = 'YOUR_ACCESS_TOKEN';
const JWKS_URI = 'http://localhost:3000/.well-known/jwks.json';

async function verifyToken() {
  // 1. 创建 JWKS 获取函数（自动根据 kid 找公钥）
  const JWKS = createRemoteJWKSet(new URL(JWKS_URI));

  // 2. 验证 Token
  try {
    const { payload, protectedHeader } = await jwtVerify(ACCESS_TOKEN, JWKS, {
      algorithms: ['RS256'], // 只允许 RS256
    });

    console.log('✅ Token 验证成功！');
    console.log('Header:', protectedHeader);
    console.log('Payload:', payload);
  } catch (err) {
    console.error('❌ Token 验证失败:', err.message);
  }
}

verifyToken();
```

运行：

```bash
npx tsx verify-token.ts
```

**预期结果**：验证成功，控制台输出 Token 的 Payload 内容。

### 第五步：理解"无状态验证"

传统 Session 验证需要查库：

```
请求 → Redis 查询 Session → 找到用户 → 通过
```

JWT 验证不需要查库：

```
请求 → 解码 Token → 用公钥验签 → 通过
```

**为什么可以无状态？**

因为 JWT 本身包含了用户信息（Payload），而且有签名保证内容不可篡改。公钥可以从 JWKS 端点获取，不需要数据库。

**这意味着什么？**

- 网关可以水平扩展，每个实例都能独立验证 Token
- 不需要共享 Session 存储
- 验证性能极高（纯计算，不需要网络 IO）

### 第六步：验证 Token 过期

故意用一个过期的 Token，验证签名验证会失败：

```typescript
// 构造一个已过期的 Token（手动修改 payload 中的 exp）
const EXPIRED_TOKEN = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNjA...' // 替换为实际的过期 Token

await jwtVerify(EXPIRED_TOKEN, JWKS);
// 抛出错误：JWTExpired
```

## 常见问题排查

### 错误：`JWTExpired`

Token 已过期。Access Token 通常有效期较短（5-15 分钟），过期后需要用 Refresh Token 换取新的 Access Token。

### 错误：`JWSSignatureVerificationFailed`

签名验证失败。可能原因：

- Token 被篡改
- 使用的公钥与签名的私钥不匹配
- `alg` 头部被修改（如被改为 `none`）

### 错误：`kid` 不匹配

如果 Token Header 中的 `kid` 在 JWKS 中找不到对应公钥，说明 OIDC 服务器可能正在进行密钥轮换。等待一会儿再试，或者检查 JWKS 端点是否返回了所有活跃的密钥。

## 实验总结

本实验的核心收获：

1. **JWT 验证只依赖公钥**：不需要秘密，不需要数据库查询
2. **公钥通过 JWKS 获取**：`kid` 用于在 JWKS 中找到对应的公钥
3. **网关可以完全无状态**：每个网关实例都能独立验证 Token，无需共享任何状态

这就是为什么 API 网关可以高效处理海量请求——它是纯计算密集型的，不依赖任何外部存储。

## 下一步

本实验验证了单 Token 的有效性。下一章我们将讨论 API 网关如何：
- 从请求中提取 Token（Header 还是 Cookie）
- 处理 Token 过期时的自动刷新
- 在验证失败时返回正确的错误响应
