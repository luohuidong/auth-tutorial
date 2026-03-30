# Google 登录集成

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 在 Google Cloud Console 创建 OAuth2 凭证并正确配置
- 使用 Passport.js 的 `passport-google-oauth20` 策略接入 Google 登录
- 实现完整的 Google OAuth2 授权码流程（含 PKCE 和 state 防护）
- 处理首次 Google 登录的用户创建逻辑
- 理解 `email_verified` 字段的安全意义
- 实现登录后的账号合并流程（同邮箱账号自动关联）

### 重点与难点

**重点**：

- Google OAuth2 凭证的两种类型：Web 应用 vs 桌面应用——选错会导致 redirect_uri 不匹配
- `email_verified` 验证——如果跳过，攻击者可能通过未验证邮箱劫持已有账号
- `access_type=offline` 参数——如果需要在用户不在线时代表用户调用 Google API，必须加这个参数

**难点**：

- Passport.js 的 `verify` 回调参数顺序——不同版本的策略参数有差异
- `hd`（托管域）限制——企业 Google Workspace 登录如何限制特定域名
- 刷新 Token 的获取时机——第一次授权才返回 `refresh_token`，`prompt=consent` 可以强制重新授权

## Google Cloud Console 配置

### 创建 OAuth2 凭证

1. 访问 [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. 点击"创建凭证" → "OAuth 客户端 ID"
3. 应用类型选"**Web 应用**"（不是桌面应用）
4. 配置"已获授权的重定向 URI"（必须与代码中的 `callbackURL` 完全一致）：

```plaintext
# 开发环境
http://localhost:3000/auth/google/callback

# 生产环境
https://auth.yourapp.com/auth/google/callback
```

5. 点击创建，记录 `Client ID` 和 `Client Secret`

**常见错误**：`redirect_uri_mismatch`——90% 的情况是 Google Console 里配置的 URI 和代码里的不一致（多一个斜杠、http vs https、端口不对）。

### 配置 OAuth Consent Screen

在 APIs & Services → OAuth consent screen 配置：

- **User Type**：External（面向所有 Google 用户）或 Internal（仅限 Google Workspace 组织成员）
- **App name**、**User support email**、**Developer contact email**（必填）
- **Scopes**：`openid`、`email`、`profile`（在授权范围里添加）
- 测试阶段可以添加测试用户，生产前需要通过 Google 的 OAuth 验证（无敏感 Scope 的应用通常可以直接发布）

## Passport.js Google 策略

### 安装依赖

```bash
pnpm add passport-google-oauth20
pnpm add -D @types/passport-google-oauth20
```

### GoogleStrategy 配置

```typescript
// src/social/google/google.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { OAuthConfigService } from '../../config/oauth-config.service';
import { SocialAuthService } from '../social-auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private readonly oauthConfigService: OAuthConfigService,
    private readonly socialAuthService: SocialAuthService
  ) {
    const googleConfig = oauthConfigService.google;

    super({
      clientID: googleConfig.clientId,
      clientSecret: googleConfig.clientSecret,
      callbackURL: googleConfig.callbackUrl,
      scope: googleConfig.scopes,
      // 请求 offline access 以获取 Refresh Token（如果需要代表用户调 Google API）
      // access_type: 'offline',
      // 强制显示授权页面（确保每次都获取 Refresh Token）
      // prompt: 'consent',
    });
  }

  // Passport 会在 OAuth 回调验证通过后调用这个方法
  async validate(
    accessToken: string,
    refreshToken: string | undefined,
    profile: Profile,
    done: VerifyCallback
  ): Promise<void> {
    try {
      // 获取主邮箱（通常第一个是主邮箱）
      const email = profile.emails?.[0]?.value;
      const emailVerified = profile.emails?.[0]?.verified;

      // 安全检查：只接受已验证的邮箱
      // 如果 email_verified 为 false，攻击者可能用未验证的邮箱关联已有账号
      if (email && emailVerified === false) {
        return done(
          new Error('Google 邮箱未验证，请先验证 Google 邮箱后再登录')
        );
      }

      const { userId } = await this.socialAuthService.findOrCreateUser({
        provider: 'google',
        providerUserId: profile.id, // Google 的 sub 字段
        email,
        name: profile.displayName,
        avatarUrl: profile.photos?.[0]?.value,
        accessToken,
        refreshToken,
        rawProfile: profile._json,
      });

      done(null, { userId });
    } catch (err) {
      done(err as Error);
    }
  }
}
```

### GoogleController

```typescript
// src/social/google/google.controller.ts
import { Controller, Get, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { SsoService } from '../../sso/sso.service';

@Controller('auth/google')
export class GoogleController {
  constructor(private readonly ssoService: SsoService) {}

  // 1. 用户点击"用 Google 登录"，重定向到 Google 授权页
  @Get()
  @UseGuards(AuthGuard('google'))
  initiateLogin() {
    // Passport 自动处理重定向，这里无需任何代码
  }

  // 2. Google 回调，Passport 验证后调用 handleCallback
  @Get('callback')
  @UseGuards(AuthGuard('google'))
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    // req.user 由 GoogleStrategy.validate() 设置
    const { userId } = req.user as { userId: string };

    // 建立 SSO Session
    const ssoSessionId = await this.ssoService.createSession(userId, {
      ip: req.ip ?? '',
      loginMethod: 'google',
    });

    res.cookie('sso_session', ssoSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 天
    });

    // 恢复 pending 的 OAuth 授权请求（如果有）
    const pendingAuthParams = req.session?.pendingAuthRequest;
    if (pendingAuthParams) {
      delete req.session.pendingAuthRequest;
      return res.redirect(
        `/oauth/authorize?${new URLSearchParams(pendingAuthParams)}`
      );
    }

    // 重定向到登录前的页面或首页
    const returnTo = req.session?.returnTo ?? '/';
    delete req.session?.returnTo;
    return res.redirect(returnTo);
  }
}
```

## state 和 PKCE 的处理

使用 `passport-google-oauth20` 时，state 和 PKCE 的处理方式有两种：

### 方式一：让 Passport 自动处理（推荐）

`passport-google-oauth20` 内置了 state 生成和验证逻辑：

```typescript
super({
  // ...
  state: true, // 自动生成和验证 state
});
```

启用 `state: true` 后，Passport 会自动生成随机 state，存在 Session 里，并在回调时验证。你无需手动管理 state。

### 方式二：自定义 state 携带应用状态

如果需要在 state 里携带额外的信息（比如登录前的页面 URL）：

```typescript
// 在 initiateLogin 中动态构造 state
@Get()
initiateLogin(@Req() req: Request, @Res() res: Response, @Query('returnTo') returnTo?: string) {
  const stateData = { returnTo: returnTo ?? '/' };
  const state = Buffer.from(JSON.stringify(stateData)).toString('base64url');
  req.session.oauthState = state;

  // 手动构建 Google 授权 URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', this.googleConfig.clientId);
  authUrl.searchParams.set('redirect_uri', this.googleConfig.callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);

  return res.redirect(authUrl.toString());
}
```

## 处理 `hd` 参数（企业 Google Workspace 登录限制）

如果你的应用只针对特定 Google Workspace 域名的用户（比如公司内部工具，只允许 `@yourcompany.com` 的账号登录），可以使用 `hd`（Hosted Domain）参数：

```typescript
// GoogleStrategy 配置中添加
super({
  // ...
  hostedDomain: 'yourcompany.com', // 只允许该域名的 Google 账号
});

// 在 validate 方法中验证
async validate(accessToken, refreshToken, profile, done) {
  const email = profile.emails?.[0]?.value;

  // 双重验证（即使配置了 hd，也要在服务端再验证一次，防止参数被篡改）
  if (!email?.endsWith('@yourcompany.com')) {
    return done(new Error('只允许公司域名邮箱登录'));
  }

  // ...继续处理
}
```

## 首次登录的用户体验设计

### 场景一：全新用户（没有任何账号）

`findOrCreateUser` 自动创建新用户记录，用户直接登录成功。

### 场景二：同邮箱账号已存在（用密码注册过）

`findOrCreateUser` 的步骤 2 会查到同邮箱用户，自动创建关联。用户登录后可以同时用 Google 或密码登录，无感知。

**安全注意点**：只有在 `email_verified` 为 `true` 时才做这个自动关联，否则攻击者可以用未验证的邮箱在 Google 上注册，然后自动关联到你系统里已有的账号。

### 场景三：首次 Google 登录，需要填写额外信息

某些场景下，用 Google 登录创建新账号时，需要用户补充一些信息（比如手机号）。可以设置一个"账号完善页"：

```typescript
// 在 handleCallback 中
const { userId, isNewUser } = req.user as {
  userId: string;
  isNewUser: boolean;
};

if (isNewUser && needsAdditionalInfo) {
  // 存储临时 userId，重定向到账号完善页
  req.session.pendingNewUserId = userId;
  return res.redirect('/auth/complete-profile');
}
```

## 获取 Refresh Token 的注意事项

Google 的 Refresh Token 有特殊逻辑：

- 第一次授权时返回 Refresh Token
- 之后的授权（用户再次点击"用 Google 登录"）不再返回 Refresh Token（因为之前授权的还有效）
- 如果需要强制获取新的 Refresh Token，必须添加 `prompt=consent`

```typescript
// 如果你需要代表用户调用 Google API（比如访问 Google Calendar），需要如下配置
super({
  // ...
  access_type: 'offline', // 告诉 Google 需要 Refresh Token
  prompt: 'consent', // 每次都显示授权页面，确保返回 Refresh Token
});
```

但要注意：`prompt=consent` 会让每次登录都弹出授权界面，影响用户体验。只有真正需要 Refresh Token 的场景才这样配置。

## Google 登录按钮（前端）

```tsx
// GoogleLoginButton.tsx
export function GoogleLoginButton() {
  const handleLogin = () => {
    // 保存当前页面 URL，登录后回来
    const returnTo = window.location.pathname;
    window.location.href = `/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
  };

  return (
    <button
      onClick={handleLogin}
      className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
    >
      {/* Google 官方 SVG 图标 */}
      <svg width="20" height="20" viewBox="0 0 48 48">
        {/* ... Google G 图标 SVG 路径 */}
      </svg>
      <span>用 Google 账号登录</span>
    </button>
  );
}
```

## 常见问题与解决方案

### Q：用户用 Google 登录后，还能设置密码吗？

**A**：可以。在账号设置页提供"设置密码"功能，用 bcrypt 哈希后写入 `users.password_hash`。之后用户就可以用邮箱 + 密码登录，或者继续用 Google 登录，两种方式都有效。

### Q：Google Icon 必须用官方图标吗？

**A**：Google 有官方的品牌标识使用规范（Branding Guidelines）。简而言之：

- 不能修改 Google 的 Logo 颜色
- 按钮文字必须是 "Sign in with Google"（英文）或本地化等价语（中文：使用 Google 账号登录）
- 不要把 Google 的 G 图标替换成其他样式

### Q：如果 Google API 宕机，登录会失败吗？

**A**：会。第三方登录依赖第三方服务的可用性。建议：

1. 至少保留一种"内建"登录方式（邮箱密码或 Magic Link），不要让 Google 登录成为唯一登录方式
2. 在 Google 回调出错时，展示友好的错误页面（"Google 暂时不可用，请用其他方式登录"）

## 本篇小结

Google 登录完全遵循 OIDC/OAuth2 标准，集成比微信简单得多。通过 `passport-google-oauth20` 策略，Passport.js 处理了大部分 OAuth2 流程细节（state 生成验证、Token 交换、Profile 解析）。

关键安全点：验证 `email_verified` 为 `true` 才做邮箱匹配的自动关联，防止攻击者通过未验证邮箱接管已有账号。

Google 的 `profile.id` 就是用户在 Google 的唯一稳定 ID（即 OIDC 的 `sub`），用它作为 `providerUserId`。

下一篇实现 GitHub 登录——GitHub 也遵循标准 OAuth2，但有几个特殊点需要注意：邮箱可能是私密的（需要单独 API 获取），以及 GitHub Apps vs OAuth Apps 的选择。
