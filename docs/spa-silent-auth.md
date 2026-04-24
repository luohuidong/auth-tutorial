# SPA 静默认证与多标签页同步

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 实现基于 `iframe` 的静默认证（`prompt=none`），让用户无感知地检测已有登录态
- 实现多标签页登录状态同步，避免用户在一个标签页退出后，其他标签页仍显示已登录
- 理解第三方 Cookie 限制对静默认证的影响，并掌握替代方案

### 重点与难点

**重点**：

- `iframe` 静默认证的完整实现流程
- 多标签页同步的两种方案：`BroadcastChannel` vs `storage` 事件
- 页面加载时的认证初始化顺序

**难点**：

- 第三方 Cookie 限制（Safari ITP、Chrome Privacy Sandbox）对静默认证的影响
- 跨标签页的刷新锁实现

## 静默认证（Silent Authentication）

### 什么是静默认证

静默认证解决的问题是：**内存中的 Access Token 在页面刷新后丢失，如何在不打扰用户（不跳转到登录页）的情况下恢复登录态？**

OIDC 提供了 `prompt=none` 参数：让浏览器以"静默模式"发起一次授权请求——如果用户在 OIDC 服务器有有效的 SSO Session，直接返回新的 Token/Code；如果没有，不显示任何 UI，直接返回错误 `login_required`。

### 基于 iframe 的实现

SPA 通常用 `iframe` 来实现静默认证，避免主页面发生跳转：

```typescript
// src/auth/silent-auth.ts

export async function trySilentAuthentication(): Promise<boolean> {
  return new Promise((resolve) => {
    // 1. 构造 prompt=none 的授权 URL
    const silentParams = new URLSearchParams({
      response_type: 'code',
      client_id: OIDC_CONFIG.clientId,
      redirect_uri: OIDC_CONFIG.silentRedirectUri, // 专用于静默认证的回调页面
      scope: OIDC_CONFIG.scopes.join(' '),
      prompt: 'none', // 关键：不显示任何 UI
      code_challenge_method: 'S256',
      // PKCE 参数也需要，因为回调时要换 Token
    });

    // 2. 创建隐藏的 iframe
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = `${OIDC_CONFIG.authorizeEndpoint}?${silentParams.toString()}`;
    document.body.appendChild(iframe);

    // 3. 超时处理：如果 10 秒内没有响应，视为失败
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, 10_000);

    // 4. 监听来自静默回调页面的消息
    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== OIDC_CONFIG.issuer) return;

      if (event.data?.type === 'silent_auth_success') {
        tokenStore.save(event.data.tokens);
        cleanup();
        resolve(true);
      } else if (event.data?.type === 'silent_auth_failure') {
        cleanup();
        resolve(false);
      }
    };

    window.addEventListener('message', messageHandler);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', messageHandler);
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }
  });
}
```

静默回调页面（`/silent-callback`）是一个轻量级页面，完成 Token 换取后通过 `postMessage` 通知父页面：

```typescript
// src/pages/SilentCallback.tsx
// 这个页面在 iframe 中加载，处理 prompt=none 回调

useEffect(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  if (error) {
    window.parent.postMessage(
      { type: 'silent_auth_failure', error },
      window.location.origin
    );
    return;
  }

  if (code) {
    exchangeCodeForTokens(code, codeVerifier)
      .then((tokens) => {
        window.parent.postMessage(
          { type: 'silent_auth_success', tokens },
          window.location.origin
        );
      })
      .catch(() => {
        window.parent.postMessage(
          { type: 'silent_auth_failure', error: 'exchange_failed' },
          window.location.origin
        );
      });
  }
}, []);
```

### 第三方 Cookie 的限制与替代方案

`iframe` 静默认证的工作前提是：**iframe 中的 OIDC 服务器页面能读取到用户的 SSO Session Cookie**。

但现代浏览器正在逐步限制第三方 Cookie：

| 浏览器 | 政策 |
|--------|------|
| Safari | 默认阻止第三方 Cookie（ITP） |
| Chrome | 2024 年起逐步淘汰第三方 Cookie（Privacy Sandbox） |
| Firefox | 默认启用 Total Cookie Protection |

**影响**：如果 SPA 部署在 `app.example.com`，OIDC 服务器在 `auth.example.com`，那么在 `app.example.com` 页面中嵌入指向 `auth.example.com` 的 iframe，Safari 这类浏览器会阻止 `auth.example.com` 的 SSO Session Cookie，导致静默认证永远返回 `login_required`。

**应对策略**：

1. **相同顶级域名**：将 SPA 和 OIDC 服务器部署在同一顶级域名下（如 `app.example.com` 和 `auth.example.com`），可以使用 `domain=.example.com` 的 Cookie
2. **使用 Refresh Token 恢复**：页面加载时，先尝试用存储的 Refresh Token 换取新 Access Token，不依赖 iframe
3. **迁移至 BFF 模式**：把 Token 管理移到服务端，用 HttpOnly Cookie 维持 Session，完全绕开第三方 Cookie 问题

### 页面初始化顺序

推荐的页面加载时初始化顺序：

```typescript
// src/auth/auth-initializer.ts

export async function initializeAuth(): Promise<void> {
  // 1. 优先尝试用 Refresh Token 恢复（不依赖 iframe，更可靠）
  const refreshToken = tokenStore.getRefreshToken();
  if (refreshToken) {
    try {
      await refreshAccessToken();
      return; // 恢复成功
    } catch {
      // Refresh Token 失效，继续尝试静默认证
    }
  }

  // 2. 尝试 iframe 静默认证
  const silentSuccess = await trySilentAuthentication();
  if (silentSuccess) {
    return;
  }

  // 3. 都失败，用户需要重新登录
  tokenStore.clear();
}
```

## 多标签页同步

### 问题场景

用户用两个标签页打开你的应用：

- 标签页 A：用户正在操作
- 标签页 B：用户执行了退出登录

退出登录后，标签页 A 的内存中还有旧的 Access Token，页面还显示"已登录"状态。如果用户在标签页 A 发起 API 请求，得到 401 才意识到自己已经退出了。

### 方案一：BroadcastChannel API

`BroadcastChannel` 允许同源的页面/标签页之间发消息，是多标签页通信的现代方案：

```typescript
// src/auth/auth-broadcast.ts

type AuthEvent =
  | { type: 'logout' }
  | { type: 'token_refreshed'; userId: string }
  | { type: 'login'; userId: string };

class AuthBroadcast {
  private channel: BroadcastChannel;

  constructor() {
    this.channel = new BroadcastChannel('auth_sync');
    this.channel.onmessage = this.handleMessage.bind(this);
  }

  broadcast(event: AuthEvent): void {
    this.channel.postMessage(event);
  }

  private handleMessage(event: MessageEvent<AuthEvent>): void {
    const data = event.data;

    switch (data.type) {
      case 'logout':
        tokenStore.clear();
        authState.setUser(null);
        break;

      case 'token_refreshed':
        if (data.userId !== authState.getUserId()) {
          window.location.reload();
        }
        break;

      case 'login':
        if (!authState.isAuthenticated()) {
          authState.setNeedsRefresh(true);
        }
        break;
    }
  }

  destroy(): void {
    this.channel.close();
  }
}

export const authBroadcast = new AuthBroadcast();
```

在退出登录时广播事件：

```typescript
export async function logout(): Promise<void> {
  await revokeTokens();
  tokenStore.clear();
  authBroadcast.broadcast({ type: 'logout' });
  authState.setUser(null);
}
```

### 方案二：storage 事件（兼容旧浏览器）

`BroadcastChannel` 的兼容性不如 `storage` 事件（`BroadcastChannel` 在 iOS Safari 15.4+ 才支持）。`storage` 事件在 `localStorage` 发生变化时触发，且 **只在其他标签页** 触发：

```typescript
// src/auth/storage-sync.ts

export function initStorageSync(): void {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === 'auth_logout_signal') {
      tokenStore.clear();
      authState.setUser(null);
    }

    if (event.key === 'auth_login_signal') {
      if (!authState.isAuthenticated()) {
        initializeAuth();
      }
    }
  });
}

// 退出时写入 localStorage 触发 storage 事件
export async function logout(): Promise<void> {
  tokenStore.clear();

  const signal = String(Date.now());
  localStorage.setItem('auth_logout_signal', signal);
  localStorage.removeItem('auth_logout_signal');
}
```

### 常见问题与解决方案

#### 问题一：SPA 刷新页面后反复跳转到登录页

**症状**：用户刷新页面，SPA 进入"未登录 → 跳转登录 → 登录 → 回来 → 刷新 → 未登录"的死循环。

**原因**：SPA 初始化时没有等待 `initializeAuth()` 完成就检查登录状态。

**解决**：在应用根组件中，用 `isLoading` 状态保证 `initializeAuth()` 完成前不渲染路由：

```tsx
function App() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return <div>初始化中...</div>;
  }

  return <RouterProvider router={router} />;
}
```

#### 问题二：Refresh Token 轮转后登录态丢失

**原因**：并发刷新防护没有覆盖跨标签页的情况。

**解决**：刷新成功后，通过 `BroadcastChannel` 将新 Token 分发给其他标签页：

```typescript
async function doRefresh(): Promise<void> {
  const tokens = await fetchNewTokens();
  tokenStore.save(tokens);

  authBroadcast.broadcast({
    type: 'token_refreshed',
    userId: tokenStore.getUser()?.id ?? '',
  });
}
```

#### 问题三：ID Token 数据与实际用户信息不同步

**原因**：ID Token 是静态的，修改用户信息不会让已颁发的 ID Token 失效。

**解决**：调用 OIDC 的 `UserInfo` 端点获取最新信息：

```typescript
export async function fetchUserInfo(): Promise<UserInfo> {
  const response = await authenticatedFetch(`${OIDC_CONFIG.issuer}/oauth/userinfo`);
  return response.json();
}
```

## 本篇小结

- **静默认证依赖第三方 Cookie**，在 Safari 等浏览器上可能失效，Refresh Token 恢复是更可靠的替代方案
- **多标签页同步**用 `BroadcastChannel`（现代浏览器）或 `storage` 事件（兼容方案）
- **并发刷新锁**在跨标签页场景下也要同步，通过 `BroadcastChannel` 分发新 Token

如果你的应用对安全性要求更高（金融、医疗、B 端 SaaS），请阅读下一篇 **Web 应用接入（BFF 模式）**，了解如何将 Token 管理完全移到服务端。
