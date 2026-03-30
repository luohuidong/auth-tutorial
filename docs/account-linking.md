# 账号体系整合

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 理解账号关联（Account Linking）的完整场景和设计原则
- 实现账号绑定：为已登录用户添加新的第三方登录方式
- 实现账号解绑：移除某种登录方式，并处理"最后一种登录方式"的边界情况
- 处理账号冲突：两个不同的本地账号关联了同一邮箱时如何合并
- 实现"找回账号"：用户忘记用哪种方式登录时的处理策略

### 重点与难点

**重点**：

- 账号绑定必须要求用户已登录（确认身份），防止他人替用户绑定账号
- 解绑前必须确认用户还有其他登录方式，防止用户锁死自己的账号
- 账号合并的不可逆性——合并后的操作很难撤销，需要二次确认

**难点**：

- 邮箱冲突时的账号合并：必须决定哪个账号是"主账号"，另一个的数据如何迁移
- 并发绑定的竞态：两个请求同时绑定同一个第三方账号到两个不同用户会怎样？
- 不同登录方式之间的信任传递：Google 已验证的邮箱可以自动关联，但如何处理未验证邮箱？

## 账号关联的三种场景

理解账号关联，先要清楚用户会遇到的实际场景：

### 场景一：首次第三方登录，邮箱与已有账号匹配

用户之前用邮箱密码注册过账号，现在第一次点击"用 Google 登录"。Google 返回的邮箱与系统里已有账号一致。

**处理方式**：自动关联（`findOrCreateUser` 步骤 2）。用户无感知，以后可以用 Google 或密码两种方式登录。

**前提条件**：仅当 `email_verified: true` 时才自动关联，防止攻击者通过未验证邮箱接管账号。

### 场景二：用户主动绑定新登录方式

已登录的用户在账号设置页，点击"绑定 GitHub 账号"——明确地把 GitHub 登录方式添加到自己的账号。

**处理方式**：验证用户已登录 → 走 GitHub OAuth2 → 拿到 Profile → 创建 `linked_accounts` 记录（关联当前用户）。

### 场景三：账号冲突——第三方账号已被别人绑定

用户 A 尝试绑定某个 GitHub 账号，但这个 GitHub 账号已经被用户 B 绑定了。

**处理方式**：拒绝绑定，返回错误，提示用户该第三方账号已被使用。**不要静默地解绑再重绑**——这可能是误操作或攻击。

## 账号绑定实现

### 绑定端点设计

```typescript
// 账号绑定流程：在已登录状态下，向账号添加新的登录方式
GET /account/link/{provider}?returnTo=/settings/security
// → 重定向到对应 Provider 的 OAuth 授权页，但在 state 里标记"这是绑定流程而非登录流程"
// → 回调时，创建 linked_account（关联当前登录用户），而不是走 findOrCreateUser

GET /account/link/{provider}/callback?code=...&state=...
// → OAuth 回调，完成绑定
```

**关键**：`state` 参数里带上绑定标记和当前用户 ID：

```typescript
const statePayload = {
  nonce: randomBytes(16).toString('hex'),
  mode: 'link', // 区分"登录流程"和"绑定流程"
  userId: currentUserId, // 当前已登录用户的 ID
  returnTo: '/settings',
};
const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
```

### AccountLinkingService 实现

```typescript
// src/account/account-linking.service.ts
import {
  Injectable,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { db } from '../db';
import { users, linkedAccounts, type OAuthProvider } from '../db/schema';
import { eq, and, ne, count } from 'drizzle-orm';

export interface ExternalProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email?: string;
  name: string;
  avatarUrl?: string;
  rawProfile: Record<string, unknown>;
}

@Injectable()
export class AccountLinkingService {
  /**
   * 将外部账号绑定到指定用户
   * 只在用户 **已登录** 时调用
   */
  async linkAccount(userId: string, profile: ExternalProfile): Promise<void> {
    // 1. 检查该外部账号是否已被任何用户绑定
    const [existingLink] = await db
      .select()
      .from(linkedAccounts)
      .where(
        and(
          eq(linkedAccounts.provider, profile.provider),
          eq(linkedAccounts.providerUserId, profile.providerUserId)
        )
      )
      .limit(1);

    if (existingLink) {
      if (existingLink.userId === userId) {
        // 已经绑定了同一个账号——幂等，不抛错
        return;
      }
      // 被其他用户绑定了
      throw new ConflictException(
        `该 ${profile.provider} 账号已绑定到其他用户，请先解绑后再试`
      );
    }

    // 2. 检查当前用户是否已绑定了该 Provider 的另一个账号
    const [existingProviderLink] = await db
      .select()
      .from(linkedAccounts)
      .where(
        and(
          eq(linkedAccounts.userId, userId),
          eq(linkedAccounts.provider, profile.provider)
        )
      )
      .limit(1);

    if (existingProviderLink) {
      throw new ConflictException(
        `你已绑定了一个 ${profile.provider} 账号，请先解绑当前的再绑定新的`
      );
    }

    // 3. 创建绑定记录
    await db.insert(linkedAccounts).values({
      userId,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      rawProfile: profile.rawProfile,
    });
  }

  /**
   * 解除某个外部账号的绑定
   * 必须确保解绑后用户还有其他登录方式
   */
  async unlinkAccount(userId: string, provider: OAuthProvider): Promise<void> {
    // 1. 查找要解绑的记录
    const [link] = await db
      .select()
      .from(linkedAccounts)
      .where(
        and(
          eq(linkedAccounts.userId, userId),
          eq(linkedAccounts.provider, provider)
        )
      )
      .limit(1);

    if (!link) {
      throw new BadRequestException(`未找到 ${provider} 的绑定记录`);
    }

    // 2. 检查解绑后是否还有其他登录方式
    const [user] = await db
      .select({ passwordHash: users.passwordHash, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // 其他 linked_accounts 数量
    const [{ count: otherLinkedCount }] = await db
      .select({ count: count() })
      .from(linkedAccounts)
      .where(
        and(
          eq(linkedAccounts.userId, userId),
          ne(linkedAccounts.provider, provider) // 排除当前要解绑的
        )
      );

    const hasPassword = !!user?.passwordHash;
    const hasOtherLinkedAccounts = Number(otherLinkedCount) > 0;

    if (!hasPassword && !hasOtherLinkedAccounts) {
      throw new ForbiddenException(
        '无法解绑：这是你唯一的登录方式，解绑后将无法登录。请先设置密码或绑定其他登录方式。'
      );
    }

    // 3. 执行解绑
    await db
      .delete(linkedAccounts)
      .where(
        and(
          eq(linkedAccounts.userId, userId),
          eq(linkedAccounts.provider, provider)
        )
      );
  }

  /**
   * 获取用户的所有登录方式
   */
  async getLinkedAccounts(userId: string) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const linked = await db
      .select({
        provider: linkedAccounts.provider,
        providerUserId: linkedAccounts.providerUserId,
        createdAt: linkedAccounts.createdAt,
      })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.userId, userId));

    return {
      hasPassword: !!user?.passwordHash,
      email: user?.email,
      linkedAccounts: linked,
    };
  }
}
```

## 解绑前的最后确认

解绑是危险操作，用户界面应该有清晰的说明：

```tsx
// UnlinkButton.tsx
function UnlinkButton({
  provider,
  isLastLoginMethod,
}: {
  provider: string;
  isLastLoginMethod: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (isLastLoginMethod) {
    return (
      <button disabled title="这是你唯一的登录方式，无法解绑">
        解绑（不可用）
      </button>
    );
  }

  if (confirming) {
    return (
      <div>
        <p>确定要解绑 {provider} 账号吗？</p>
        <button onClick={() => handleUnlink(provider)}>确定解绑</button>
        <button onClick={() => setConfirming(false)}>取消</button>
      </div>
    );
  }

  return <button onClick={() => setConfirming(true)}>解绑</button>;
}
```

## 账号合并：处理邮箱冲突

最复杂的场景：两个独立创建的本地账号，现在被发现对应同一个用户。

### 什么时候发生

用户 A 用 `alice@example.com` 注册了密码账号；用户 A 用 Google 登录（Google 账号邮箱也是 `alice@example.com`）——`findOrCreateUser` 自动关联，没有冲突。

但如果：用户 A 用 `alice@example.com` 注册密码账号 → 用 GitHub 登录（GitHub 邮箱是私密的，系统没有邮箱 → 创建了新用户）。

现在系统里有：

- 账号 A（`alice@example.com`，密码登录，userId=1）
- 账号 B（无邮箱，GitHub 登录，userId=2）

用户现在想把这两个账号合并。

### 合并策略

```typescript
// src/account/account-merge.service.ts
import { Injectable } from '@nestjs/common';
import { db } from '../db';
import { users, linkedAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class AccountMergeService {
  /**
   * 合并两个账号（以 primaryUserId 为主账号，secondaryUserId 的数据迁移过来后删除）
   */
  async mergeAccounts(
    primaryUserId: string,
    secondaryUserId: string
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // 1. 把次账号的所有 linked_accounts 迁移到主账号
      await tx
        .update(linkedAccounts)
        .set({ userId: primaryUserId, updatedAt: new Date() })
        .where(eq(linkedAccounts.userId, secondaryUserId));

      // 2. 把次账号的业务数据迁移到主账号
      // （根据具体业务需求，可能涉及 orders、posts、favorites 等表，这里只是示意）
      // await tx.update(orders).set({ userId: primaryUserId }).where(eq(orders.userId, secondaryUserId));

      // 3. 如果次账号有邮箱而主账号没有，迁移邮箱
      const [secondary] = await tx
        .select({ email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, secondaryUserId))
        .limit(1);

      const [primary] = await tx
        .select({ email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, primaryUserId))
        .limit(1);

      const updates: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (!primary?.email && secondary?.email) {
        updates.email = secondary.email;
      }

      if (!primary?.passwordHash && secondary?.passwordHash) {
        updates.passwordHash = secondary.passwordHash;
      }

      if (Object.keys(updates).length > 1) {
        // 有实际更新（除了 updatedAt）
        await tx.update(users).set(updates).where(eq(users.id, primaryUserId));
      }

      // 4. 删除次账号
      await tx.delete(users).where(eq(users.id, secondaryUserId));
    });
  }
}
```

### 合并操作的前提条件

1. **二次确认**：合并操作不可逆，必须让用户明确确认
2. **同时登录两个账号**：理想情况下，用户先登录主账号，再验证次账号的所有权（比如完成次账号的登录流程）
3. **审计日志**：记录合并操作（谁在什么时候合并了哪两个账号）

## 账号管理 API 设计

```typescript
// src/account/account.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SsoAuthGuard } from '../guards/sso-auth.guard'; // 自定义守卫，验证 SSO Session

@Controller('account')
@UseGuards(SsoAuthGuard) // 所有账号管理 API 都需要登录
export class AccountController {
  // 查看我的所有登录方式
  @Get('linked-accounts')
  async getLinkedAccounts(@Req() req: Request) {
    const userId = (req as any).userId; // 从 SSO Session 获取
    return this.accountLinkingService.getLinkedAccounts(userId);
  }

  // 发起绑定（跳转到 OAuth 授权页）
  @Get('link/:provider')
  async initiateLink(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const userId = (req as any).userId;

    // 在 state 里标记这是 link 流程
    const state = Buffer.from(
      JSON.stringify({
        nonce: randomBytes(16).toString('hex'),
        mode: 'link',
        userId,
      })
    ).toString('base64url');

    // 存入 Session（回调时验证）
    (req as any).session.linkState = state;

    // 根据 provider 构造对应的 OAuth URL
    const authUrl = this.buildOAuthUrl(provider, state);
    return res.redirect(authUrl);
  }

  // 解绑
  @Delete('link/:provider')
  async unlinkAccount(
    @Param('provider') provider: string,
    @Req() req: Request
  ) {
    const userId = (req as any).userId;
    await this.accountLinkingService.unlinkAccount(
      userId,
      provider as OAuthProvider
    );
    return { success: true };
  }
}
```

## 安全账号设置页（前端）

```tsx
// AccountSecuritySettings.tsx
function AccountSecuritySettings() {
  const { data: accountInfo } = useQuery({
    queryKey: ['linked-accounts'],
    queryFn: () => fetch('/account/linked-accounts').then((r) => r.json()),
  });

  const totalLoginMethods =
    (accountInfo?.hasPassword ? 1 : 0) +
    (accountInfo?.linkedAccounts?.length ?? 0);

  return (
    <div>
      <h2>登录方式</h2>

      {/* 密码登录 */}
      <div>
        <span>密码登录</span>
        {accountInfo?.hasPassword ? (
          <span>已设置</span>
        ) : (
          <a href="/account/set-password">设置密码</a>
        )}
      </div>

      {/* 第三方登录方式 */}
      {['google', 'github', 'wechat'].map((provider) => {
        const link = accountInfo?.linkedAccounts?.find(
          (l: any) => l.provider === provider
        );
        const isLastMethod = totalLoginMethods <= 1 && !!link;

        return (
          <div key={provider}>
            <span>{provider} 登录</span>
            {link ? (
              <UnlinkButton
                provider={provider}
                isLastLoginMethod={isLastMethod}
              />
            ) : (
              <a href={`/account/link/${provider}`}>绑定</a>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

## 常见问题与解决方案

### Q：用户忘记了自己用哪种方式注册，怎么帮他找回账号？

**A**：这是账号找回（Account Recovery）问题，常见方案：

1. **邮箱验证码找回**：如果账号绑定了邮箱，发验证码确认身份后重置登录方式
2. **Magic Link 找回**：如果有邮箱，发 Magic Link 让用户登录，进入后绑定新的登录方式
3. **人工审核**：对于无法通过自动化方式找回的账号，提供客服渠道

在账号设置里强制引导用户绑定邮箱（即使他用 GitHub 登录），可以避免大多数找回困难的场景。

### Q：如何防止有人批量关联他人账号？

**A**：账号绑定（`/account/link/:provider`）和绑定回调必须要求用户 **当前处于登录状态**（有有效的 SSO Session）。只有已登录的用户才能为自己的账号发起绑定，他人无法替你绑定账号。

同时，state 参数里带着 `userId`，回调时在服务器端验证 state 的签名，防止 state 被篡改（把 userId 改成别人的）。

### Q：用户从一个设备登录 Google，在另一个设备登录 GitHub，两次登录会指向同一个账号吗？

**A**：取决于邮箱是否匹配：

- 如果 Google 和 GitHub 的邮箱相同 → 第一次 Google 登录创建账号，第二次 GitHub 登录发现同邮箱 → 自动关联，同一个账号
- 如果邮箱不同 → 创建了两个独立账号（需要用户手动合并）

## 本篇小结

账号体系整合的核心是管理 `linked_accounts` 表——一个用户可以有多种登录方式，每种方式由 `(provider, providerUserId)` 唯一标识。

**绑定**要求用户已登录（防止他人替用户绑定），检查目标外部账号是否已被他人绑定（ConflictException）。

**解绑**要确保用户解绑后仍有其他登录方式（至少有密码或其他 linked_account），否则拒绝解绑，防止用户锁死自己的账号。

**账号合并**是最复杂的场景，将次账号的 `linked_accounts` 和业务数据迁移到主账号，在事务中完成，操作前要二次确认（不可逆）。

前端账号设置页展示所有登录方式，当某种方式是唯一登录方式时禁用"解绑"按钮。

至此，模块五的八篇教程全部完成——从 OAuth2 协议原理，到 OIDC 身份认证，到项目初始化，再到四种第三方/无密码登录方式（微信扫码、Google、GitHub、Magic Link），最后到账号体系整合，构成了一套完整的第三方登录集成方案。
