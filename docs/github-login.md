# GitHub 登录集成

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 理解 GitHub OAuth Apps 与 GitHub Apps 的区别及选择依据
- 正确配置 GitHub OAuth App 并获取凭证
- 使用 `passport-github2` 策略实现 GitHub 登录
- 处理 GitHub 用户邮箱的特殊情况（邮箱可能是私密的）
- 正确使用 GitHub 的用户 ID（数字型）作为 `providerUserId`

### 重点与难点

**重点**：

- GitHub 用户的邮箱可能设为私密——`/user` 接口不返回，必须调用 `/user/emails` 单独获取
- GitHub API 返回的 `id` 是数字，需要转换为字符串存储
- Scope 的选择：`read:user` 获取基本信息，`user:email` 获取私密邮箱

**难点**：

- 部分用户不公开任何邮箱——在这种情况下如何创建账号
- GitHub Action 机器人账号的处理
- 主邮箱的判断逻辑（`primary: true` 且 `verified: true`）

## GitHub OAuth Apps vs GitHub Apps

接入 GitHub 登录有两个选项，需要先做选择：

### GitHub OAuth App

- 代表用户访问 GitHub API（以用户身份操作）
- 权限通过 OAuth Scope 声明
- 适用于：第三方登录、读取用户仓库、代表用户操作 GitHub

**这是第三方登录的正确选择**。

### GitHub App

- GitHub App 有自己的身份，不代表用户
- 更细粒度的权限控制（可以针对单个仓库授权）
- 适用于：CI/CD Bot、代码检查工具、GitHub Action 等

**结论**：第三方登录用 GitHub OAuth App。

## 创建 GitHub OAuth App

1. 访问 GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. 填写：
   - **Application name**：你的应用名称
   - **Homepage URL**：应用首页，如 `https://yourapp.com`
   - **Authorization callback URL**：回调地址，如 `https://auth.yourapp.com/auth/github/callback`
3. 点击"Register application"，生成 `Client ID`
4. 点击"Generate a new client secret"生成 `Client Secret`

**注意**：GitHub 的 Client Secret 只显示一次，生成后立即保存到 `.env` 文件。

## 安装依赖

```bash
pnpm add passport-github2
pnpm add -D @types/passport-github2
```

## GitHub 用户邮箱处理

这是 GitHub 登录最重要的特殊点。

GitHub 用户可以选择将邮箱设为私密（在 GitHub 个人设置 → Emails → 取消勾选"Keep my email addresses private" 就变为公开）。

当邮箱为私密时：`profile.email` 字段为 `null`，即使 scope 里有 `read:user`。

必须单独调用 `/user/emails` 接口（需要 `user:email` scope）:

```typescript
// 获取 GitHub 用户的主邮箱
async function fetchPrimaryEmail(
  accessToken: string
): Promise<string | undefined> {
  const response = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) return undefined;

  const emails = (await response.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
    visibility: 'public' | 'private' | null;
  }>;

  // 找主邮箱：primary: true 且 verified: true
  const primary = emails.find((e) => e.primary && e.verified);
  return primary?.email;
}
```

## GitHubStrategy 实现

```typescript
// src/social/github/github.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { OAuthConfigService } from '../../config/oauth-config.service';
import { SocialAuthService } from '../social-auth.service';

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private readonly oauthConfigService: OAuthConfigService,
    private readonly socialAuthService: SocialAuthService
  ) {
    const githubConfig = oauthConfigService.github;

    super({
      clientID: githubConfig.clientId,
      clientSecret: githubConfig.clientSecret,
      callbackURL: githubConfig.callbackUrl,
      scope: ['read:user', 'user:email'], // user:email 用于获取私密邮箱
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string | undefined,
    profile: Profile,
    done: (err: Error | null, user?: any) => void
  ): Promise<void> {
    try {
      // profile.emails 中只有公开邮箱，私密邮箱需要单独获取
      let email = profile.emails?.[0]?.value;

      // 如果没有邮箱，尝试从 /user/emails 获取
      if (!email) {
        email = await this.fetchPrimaryEmail(accessToken);
      }

      // GitHub 的 ID 是数字，转为字符串
      const providerUserId = String(profile.id);

      const { userId } = await this.socialAuthService.findOrCreateUser({
        provider: 'github',
        providerUserId,
        email, // 可能仍然为 undefined（用户完全不公开邮箱）
        name:
          profile.displayName ||
          profile.username ||
          `GitHub User ${providerUserId}`,
        avatarUrl: profile.photos?.[0]?.value,
        accessToken,
        rawProfile: profile._json,
      });

      done(null, { userId });
    } catch (err) {
      done(err as Error);
    }
  }

  private async fetchPrimaryEmail(
    accessToken: string
  ): Promise<string | undefined> {
    try {
      const response = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) return undefined;

      const emails = (await response.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;

      return emails.find((e) => e.primary && e.verified)?.email;
    } catch {
      return undefined;
    }
  }
}
```

## GitHubController 实现

```typescript
// src/social/github/github.controller.ts
import { Controller, Get, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { SsoService } from '../../sso/sso.service';

@Controller('auth/github')
export class GitHubController {
  constructor(private readonly ssoService: SsoService) {}

  @Get()
  @UseGuards(AuthGuard('github'))
  initiateLogin() {
    // Passport 自动重定向到 GitHub 授权页
  }

  @Get('callback')
  @UseGuards(AuthGuard('github'))
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    const { userId } = req.user as { userId: string };

    const ssoSessionId = await this.ssoService.createSession(userId, {
      ip: req.ip ?? '',
      loginMethod: 'github',
    });

    res.cookie('sso_session', ssoSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const pendingAuthParams = req.session?.pendingAuthRequest;
    if (pendingAuthParams) {
      delete req.session.pendingAuthRequest;
      return res.redirect(
        `/oauth/authorize?${new URLSearchParams(pendingAuthParams)}`
      );
    }

    const returnTo = req.session?.returnTo ?? '/';
    delete req.session?.returnTo;
    return res.redirect(returnTo);
  }
}
```

## GitHub 特殊场景处理

### 场景：用户没有公开任何邮箱

这种情况下 `email` 为 `undefined`，`findOrCreateUser` 会：

1. 跳过步骤 2（没有邮箱匹配）
2. 直接创建新用户，`users.email` 为 `null`

创建后，用户账号的唯一登录方式就是 GitHub 登录（无法密码登录，因为也没有邮箱用于密码找回）。账号设置页应该提示用户绑定邮箱。

### 场景：用户修改了 GitHub 用户名

`providerUserId` 是 GitHub 的数字 ID（`profile.id`），不是用户名（`profile.username`）。即使用户修改了 GitHub 用户名，数字 ID 不变，仍然能正确识别。

**不要用 GitHub 用户名（字符串）作为 `providerUserId`**——用户名可以被修改，会导致同一个用户被识别为不同账号。

### 场景：GitHub Page/组织账号登录

GitHub 的 `/user` 路径只能获取个人账号信息，组织账号不能登录第三方应用（OAuth2 面向个人用户）。如果你需要限制只允许特定组织的成员登录，可以在 validate 中调用 `https://api.github.com/user/orgs` 检查。

## GitHub 登录 vs 其他方式的差异汇总

| 特点          | Google                 | GitHub                                     |
| ------------- | ---------------------- | ------------------------------------------ |
| 邮箱可用性    | 通常总是有             | 可能为私密，需要单独 API 获取              |
| 用户唯一 ID   | `profile.id`（字符串） | `profile.id`（数字，需转字符串）           |
| Refresh Token | 支持                   | 不支持（GitHub OAuth2 没有 Refresh Token） |
| OIDC 支持     | 完整 OIDC              | 仅 OAuth2，无 ID Token                     |
| 用户名稳定性  | `sub` 稳定             | `id`（数字）稳定，`username` 可变          |

## 常见问题与解决方案

### Q：GitHub 没有 Refresh Token，Access Token 过期了怎么办？

**A**：GitHub OAuth App 的 Access Token 默认 **没有过期时间**（永久有效）。如果 GitHub 的管理员撤销了你的应用授权，Token 才会失效。

但如果你开启了 GitHub App 的"Expiring user tokens"选项，则 Token 会有效期（8 小时），且会有 Refresh Token。对于 OAuth Apps（不是 GitHub Apps），没有过期机制。

所以对于 GitHub 第三方登录场景，通常不需要存储 Refresh Token。

### Q：如何限制只允许我的 GitHub 组织成员登录？

**A**：在 `validate` 方法中，登录成功后调用 GitHub API 检查用户是否是指定组织的成员：

```typescript
const orgResponse = await fetch(
  `https://api.github.com/orgs/your-org/members/${profile.username}`,
  {
    headers: { Authorization: `Bearer ${accessToken}` },
  }
);

// 返回 204 表示是成员，返回 404 表示不是
if (orgResponse.status !== 204) {
  return done(new Error('只允许 your-org 组织成员登录'));
}
```

### Q：`passport-github2` 和 `passport-github` 有什么区别？

**A**：`passport-github` 是旧版，使用 GitHub 旧的 API 端点，维护不活跃。`passport-github2` 是社区维护的更新版本，使用 GitHub 最新的 User API，推荐使用 `passport-github2`。

## 本篇小结

GitHub 登录使用标准 OAuth2 协议，但有几个重要的特殊点：

1. **邮箱处理**：必须使用 `user:email` scope，并在 `profile.email` 为空时调用 `/user/emails` 获取主邮箱（`primary: true AND verified: true`）
2. **用户 ID**：使用数字型的 `profile.id`，转为字符串后作为 `providerUserId`，不要用可变的用户名
3. **Refresh Token**：GitHub OAuth Apps 的 Access Token 永久有效，通常不需要 Refresh Token

整体流程与 Google 登录相似：`passport-github2` 处理 OAuth2 细节，`GitHubStrategy.validate()` 拿到 Profile 后调用共享的 `findOrCreateUser` 逻辑，Controller 建立 SSO Session。

下一篇实现 Magic Link 邮箱登录——不依赖任何第三方平台，通过向用户邮箱发送一次性登录链接实现无密码登录。
