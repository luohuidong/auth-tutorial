# 前端集成实验

## 本篇导读

### 实验目标

本实验是本教程的**第一个手把手集成实验**。学完模块四的理论后，你将用自己实现的 OIDC 服务器，接入一个最简单的 SPA（单页应用）。

### 前提条件

- 完成模块三的 OIDC 服务器实现
- 启动 OIDC 服务器（`pnpm dev`）
- 服务器可访问（`http://localhost:3000` 或你的部署地址）
- 在 OIDC 服务器中注册了一个公开客户端（SPA 客户端），获取到 `client_id`

### 实验验收标准

实验完成后，你的 SPA 能够：

1. 点击"登录"按钮，跳转到 OIDC 服务器的登录页
2. 输入账号密码，授权确认
3. 被重定向回 SPA，URL 中带有 `code` 参数
4. SPA 用 `code` 换 Token，解析 ID Token 获取用户信息
5. 显示用户信息，表示登录成功

## 实验步骤

### 第一步：创建 SPA 项目

创建一个最简单的 Vanilla TypeScript SPA，不依赖任何框架，以便专注于 OIDC 集成逻辑：

```bash
mkdir spa-app && cd spa-app
pnpm init -y
pnpm add -D vite typescript
mkdir src
```

创建 `index.html`：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>OIDC SPA 实验</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 0 20px; }
    button { padding: 8px 16px; cursor: pointer; }
    .user-info { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-top: 20px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>OIDC 客户端集成实验</h1>

  <!-- 未登录状态 -->
  <div id="login-section">
    <p>这是一个演示 OIDC 授权码 Flow 的最简 SPA。</p>
    <button id="login-btn">登录</button>
  </div>

  <!-- 已登录状态 -->
  <div id="profile-section" class="hidden">
    <h2>登录成功！</h2>
    <div class="user-info">
      <p><strong>Sub（用户ID）:</strong> <span id="user-sub"></span></p>
      <p><strong>Name:</strong> <span id="user-name"></span></p>
      <p><strong>Email:</strong> <span id="user-email"></span></p>
      <p><strong>ID Token:</strong> <span id="user-idtoken"></span></p>
    </div>
    <button id="logout-btn">退出登录</button>
  </div>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

创建 `src/main.ts`：

```typescript
// OIDC 配置 - 请根据你的实际服务器地址修改
const OIDC_CONFIG = {
  issuer: 'http://localhost:3000',
  clientId: 'your-spa-client-id', // 在 OIDC 服务器注册的 client_id
  redirectUri: 'http://localhost:5173/callback', // 这个页面的地址
  scopes: ['openid', 'profile', 'email'],
};

// DOM 元素
const loginSection = document.getElementById('login-section')!;
const profileSection = document.getElementById('profile-section')!;
const loginBtn = document.getElementById('login-btn')!;
const logoutBtn = document.getElementById('logout-btn')!;
const userSub = document.getElementById('user-sub')!;
const userName = document.getElementById('user-name')!;
const userEmail = document.getElementById('user-email')!;
const userIdToken = document.getElementById('user-idtoken')!;

// ===================== PKCE 工具函数 =====================

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(43);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ===================== 状态管理 =====================

interface TokenSet {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
}

let tokens: TokenSet | null = null;

function parseJwt(token: string): any {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  );
  return JSON.parse(json);
}

function decodeIdToken(idToken: string): { sub: string; name?: string; email?: string } {
  const payload = parseJwt(idToken);
  return {
    sub: payload.sub,
    name: payload.name,
    email: payload.email,
  };
}

// ===================== OIDC 流程 =====================

async function startLogin() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  // 保存到 sessionStorage
  sessionStorage.setItem('code_verifier', codeVerifier);
  sessionStorage.setItem('oauth_state', state);

  // 构造授权 URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OIDC_CONFIG.clientId,
    redirect_uri: OIDC_CONFIG.redirectUri,
    scope: OIDC_CONFIG.scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  // 跳转到 OIDC 服务器
  window.location.href = `${OIDC_CONFIG.issuer}/oauth/authorize?${params}`;
}

async function handleCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const error = urlParams.get('error');

  if (error) {
    throw new Error(`Authorization error: ${error}`);
  }

  if (!code || !state) {
    throw new Error('Missing code or state');
  }

  // 验证 state
  const savedState = sessionStorage.getItem('oauth_state');
  if (state !== savedState) {
    throw new Error('State mismatch - possible CSRF attack');
  }

  const codeVerifier = sessionStorage.getItem('code_verifier');
  if (!codeVerifier) {
    throw new Error('Missing code verifier');
  }

  // 清除临时数据
  sessionStorage.removeItem('code_verifier');
  sessionStorage.removeItem('oauth_state');

  // 换取 Token
  const tokenResponse = await fetch(`${OIDC_CONFIG.issuer}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: OIDC_CONFIG.clientId,
      redirect_uri: OIDC_CONFIG.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.json();
    throw new Error(`Token exchange failed: ${err.error_description || err.error}`);
  }

  const tokenData = await tokenResponse.json();

  // 保存 Token（内存存储）
  tokens = {
    accessToken: tokenData.access_token,
    idToken: tokenData.id_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in - 30) * 1000,
  };

  // 清除 URL 中的参数
  window.history.replaceState({}, '', window.location.pathname);
}

function showProfile() {
  if (!tokens) return;

  const claims = decodeIdToken(tokens.idToken);
  userSub.textContent = claims.sub;
  userName.textContent = claims.name || '(无)';
  userEmail.textContent = claims.email || '(无)';
  userIdToken.textContent = tokens.idToken.slice(0, 50) + '...';

  loginSection.classList.add('hidden');
  profileSection.classList.remove('hidden');
}

function logout() {
  tokens = null;
  profileSection.classList.add('hidden');
  loginSection.classList.remove('hidden');
}

// ===================== 初始化 =====================

async function init() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has('code')) {
    // 处理回调
    try {
      await handleCallback();
      showProfile();
    } catch (err) {
      console.error('Login failed:', err);
      alert(`登录失败: ${err instanceof Error ? err.message : err}`);
    }
  } else if (tokens) {
    // 有 Token，显示用户信息
    showProfile();
  }
  // 否则显示登录按钮
}

// 绑定事件
loginBtn.addEventListener('click', startLogin);
logoutBtn.addEventListener('click', logout);

// 启动
init();
```

### 第二步：配置 Vite

创建 `vite.config.ts`：

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
});
```

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

### 第三步：在 OIDC 服务器注册客户端

在 OIDC 服务器中注册一个新的公开客户端：

```bash
# 假设 OIDC 服务器提供了一个管理 API
# 或者你可以通过管理后台界面注册

# 记录下返回的 client_id，你需要把它填入上面的 OIDC_CONFIG
```

**关键配置**：

- **客户端类型**：公开客户端（Public Client）
- **重定向 URI**：`http://localhost:5173/callback`（必须与 SPA 的实际地址一致）
- **授权方式**：PKCE（S256）
- **Scope**：`openid profile email`

### 第四步：启动并测试

启动 SPA：

```bash
pnpm dev
```

访问 `http://localhost:5173`，点击"登录"按钮。

**预期流程**：

1. 浏览器跳转到 OIDC 服务器的授权页面
2. 输入账号密码登录
3. 显示授权确认页面（如果需要）
4. 重定向回 `http://localhost:5173/callback?code=xxx&state=xxx`
5. SPA 用 `code` 换 Token
6. 解析 ID Token，显示用户信息

**成功标志**：页面显示用户的 `sub`、`name`、`email`，以及 ID Token 的片段。

## 常见问题排查

### 错误：`redirect_uri_mismatch`

OIDC 服务器返回这个错误，说明注册的重定向 URI 和实际使用的 URI 不一致。

**解决**：检查 OIDC 服务器中注册的 `redirect_uri` 是否精确等于 `http://localhost:5173/callback`（包括协议、端口、路径）。

### 错误：`invalid_grant`（code 已使用或过期）

授权码只能使用一次。如果刷新页面时 URL 中仍有 `code`，重复使用会导致此错误。

**解决**：确保 `handleCallback` 成功后调用 `window.history.replaceState` 清除 URL 中的 `code` 参数。

### 错误：`invalid_code_challenge`

PKCE 验证失败。可能原因：

- `code_verifier` 在传输过程中被修改
- 哈希算法不是 `S256`
- `code_verifier` 长度不在 43-128 字节范围内

**排查**：检查 `generateCodeChallenge` 函数是否正确使用了 SHA-256 和 Base64URL 编码。

### 浏览器控制台报错：跨域 CORS

如果 OIDC 服务器和 SPA 部署在不同域名，浏览器会阻止 Token 请求。

**解决**：确保 OIDC 服务器的 Token 端点配置了正确的 CORS 头，允许 SPA 域名的请求。

## 实验总结

完成本实验后，你应该对 OIDC 客户端集成有了完整的理解：

1. **PKCE 流程**：公开客户端如何用 `code_verifier`/`code_challenge` 代替 `client_secret`
2. **授权码换取 Token**：SPA 后端（在这个例子中是前端 JS）如何用 `code` 换 Token
3. **ID Token 解析**：如何解码 JWT 获取用户信息
4. **状态管理**：如何处理登录状态

如果遇到问题不要着急，对照排查清单逐步检查。你已经理解了 OIDC 的理论，实践中的坑都是宝贵的经验。

## 下一步

本实验使用了最简单的内存存储方式管理 Token。下一章我们将讨论实际生产环境中 Token 存储的最佳实践，以及如何处理 Token 刷新、静默认证等更复杂场景。
