# JWT 验证中间件

## 本篇导读

**核心目标**

- 理解 API 网关验证 JWT 的完整流程，掌握 JWKS 端点的作用
- 实现线程安全的 JWKS 公钥缓存，防止高并发下的重复请求
- 使用 Mutex 解决缓存击穿（Cache Stampede）问题
- 实现熔断器（Circuit Breaker），在认证服务不可用时保护网关稳定性
- 通过随机 TTL 抖动防止缓存雪崩（Cache Avalanche）

**重点**

- JWKS 的结构和 `kid`（Key ID）的作用
- 并发安全的缓存更新：多个请求同时发现缓存失效时，只有一个去拉取新公钥
- 熔断器状态机：Closed、Open、Half-Open 三种状态的转换逻辑

**难点**

- 在无状态的 NestJS 请求处理环境中实现有状态的熔断器
- 区分缓存击穿、缓存穿透、缓存雪崩三种缓存问题

## JWT 验证的核心挑战

### 业务服务 vs API 网关

| 维度     | 业务服务（模块三）  | API 网关（本篇）            |
| -------- | ------------------- | --------------------------- |
| 公钥来源 | 环境变量（静态）    | JWKS 端点（动态）           |
| 公钥数量 | 只有一把            | 可能有多把（按 `kid` 区分） |
| 密钥轮换 | 需要重启服务        | 自动获取新公钥              |
| 验证频率 | 服务内部用户        | 所有下游服务的所有请求      |
| 并发压力 | 中等                | 极高（所有流量的必经之路）  |
| 降级策略 | 无需特殊考虑        | 认证服务不可用时需要熔断    |

### JWKS 端点与公钥格式

JWKS（JSON Web Key Set）是标准的公钥分发格式：

```plaintext
GET /.well-known/jwks.json

{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "key-2026-03-01",
      "n": "pjdss8ZaDfEH6K6U7GeW2nxDqR4IP049fk1fK0lndimbMMVBdPv_hSpm8T...",
      "e": "AQAB",
      "alg": "RS256"
    }
  ]
}
```

- **`kty`**：Key Type，`RSA` 表示 RSA 密钥
- **`kid`**：Key ID，唯一标识一把密钥
- **`n`** 和 **`e`**：RSA 公钥的模数和指数，Base64URL 编码

验证流程：从 JWT Header 中提取 `kid`，在 JWKS 中查找对应公钥，验证签名。

## 公钥缓存设计

### 为什么必须缓存

假设网关每秒处理 10,000 个请求，每个请求都发起一次 HTTPS 请求到 JWKS 端点（约 10-50ms），认证服务的 JWKS 端点会被打崩。

### 缓存结构设计

```typescript
interface CachedKey {
  key: KeyLike;        // jose 库的 KeyLike 对象
  expiresAt: number;   // 过期时间戳（毫秒）
}

// 内存缓存：kid → CachedKey
private readonly cache = new Map<string, CachedKey>();
```

以 `kid` 为键可以同时存储多把公钥，支持密钥轮换期间的平滑过渡。

**TTL 考量**：

| TTL 太短（< 5 分钟）    | TTL 太长（> 24 小时）                           |
| ----------------------- | ------------------------------------------------- |
| 频繁请求 JWKS，增加延迟 | 密钥轮换后仍用旧公钥，拒绝新 Token              |
| 认证服务压力大          | 密钥泄露时旧 Token 仍可通过验证                  |

推荐 TTL：**1 小时**。认证服务执行密钥轮换时，应保持旧密钥在 JWKS 中至少 24 小时。

### 缓存雪崩防护：随机 TTL 抖动

**问题**：如果网关在 12:00 启动时将所有公钥存入缓存，TTL 统一 1 小时，那么 13:00 时所有公钥同时过期，所有请求同时涌向 JWKS 端点。

**解决方案**：为每个缓存条目的 TTL 添加随机偏移（±15 分钟）：

```typescript
const BASE_TTL_MS = 60 * 60 * 1000; // 1 小时
const JITTER_MS = 15 * 60 * 1000;   // ±15 分钟

function computeTTL(): number {
  const jitter = (Math.random() - 0.5) * 2 * JITTER_MS;
  return BASE_TTL_MS + jitter;
}
```

## 并发锁：解决缓存击穿

### 缓存击穿（Cache Stampede）问题

当某个 `kid` 的缓存过期时，多个并发请求同时发现缓存失效，都去请求 JWKS，导致重复请求。

### 使用互斥锁（Mutex）防止重复拉取

Node.js 的非阻塞 I/O 允许多个异步操作同时"挂起"。用 Promise 作为锁：第一个请求将 JWKS 拉取的 Promise 存储起来，后续请求直接 `await` 同一个 Promise。

```typescript
// auth/jwks-cache.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, JWTVerifyGetKey, KeyLike, importJWK } from 'jose';

interface CachedKey {
  key: KeyLike;
  expiresAt: number;
}

@Injectable()
export class JwksCacheService implements OnModuleInit {
  private readonly logger = new Logger(JwksCacheService.name);

  // kid → 缓存的公钥
  private readonly keyCache = new Map<string, CachedKey>();

  // 正在进行的 JWKS 拉取 Promise（Mutex）
  private fetchingPromise: Promise<void> | null = null;

  private readonly jwksUri: string;
  private readonly BASE_TTL_MS = 60 * 60 * 1000;
  private readonly JITTER_MS = 15 * 60 * 1000;

  constructor(private readonly config: ConfigService) {
    this.jwksUri = this.config.getOrThrow<string>('JWKS_URI');
  }

  async onModuleInit() {
    await this.refreshKeys().catch((err) => {
      this.logger.warn('Failed to prefetch JWKS on startup', err.message);
    });
  }

  async getKey(kid: string): Promise<KeyLike | null> {
    const cached = this.keyCache.get(kid);

    if (cached && Date.now() < cached.expiresAt) {
      return cached.key;
    }

    // Mutex：只有一个请求去刷新，其他等待
    if (!this.fetchingPromise) {
      this.fetchingPromise = this.refreshKeys().finally(() => {
        this.fetchingPromise = null;
      });
    }

    await this.fetchingPromise;
    return this.keyCache.get(kid)?.key ?? null;
  }

  private async refreshKeys(): Promise<void> {
    const response = await fetch(this.jwksUri, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`JWKS fetch failed: ${response.status} ${response.statusText}`);
    }

    const jwks: { keys: JsonWebKey[] } = await response.json();

    for (const jwk of jwks.keys) {
      if (!jwk.kid || jwk.use !== 'sig') continue;

      try {
        const key = (await importJWK(jwk)) as KeyLike;
        const ttl = this.computeTTL();

        this.keyCache.set(jwk.kid, {
          key,
          expiresAt: Date.now() + ttl,
        });
      } catch (err) {
        this.logger.warn(`Failed to import JWK kid=${jwk.kid}`, err);
      }
    }
  }

  private computeTTL(): number {
    const jitter = (Math.random() - 0.5) * 2 * this.JITTER_MS;
    return Math.max(this.BASE_TTL_MS + jitter, 30 * 60 * 1000);
  }
}
```

**Mutex 执行过程**：

1. 请求 1 发现 `fetchingPromise === null`，创建刷新 Promise 并赋值
2. 请求 2、3 到来，发现 `fetchingPromise !== null`，直接 `await` 同一 Promise
3. JWKS 拉取完成，清除 Promise，请求 1、2、3 继续执行

## 熔断器：应对认证服务故障

### 什么是熔断器

当某个下游服务持续出错时，停止向该服务发请求，直接返回错误，保护整个系统。

### 三种状态

| 状态        | 行为                                         |
| ----------- | -------------------------------------------- |
| **Closed**  | 正常状态，所有请求正常转发，监控失败次数     |
| **Open**    | 熔断状态，所有请求立即返回错误               |
| **HalfOpen**| 探测状态，允许部分请求通过，观察是否恢复    |

**转换逻辑**：
- Closed → Open：连续失败次数超过阈值（5 次）
- Open → HalfOpen：超过重置等待时间（30 秒）
- HalfOpen → Closed：足够多的试探请求成功（2 次）
- HalfOpen → Open：试探请求失败

### 熔断器实现

```typescript
// auth/circuit-breaker.ts
export enum CircuitState {
  Closed = 'CLOSED',
  Open = 'OPEN',
  HalfOpen = 'HALF_OPEN',
}

interface CircuitBreakerOptions {
  failureThreshold: number;  // 开始熔断的失败次数阈值
  resetTimeout: number;      // 熔断后多久进入 Half-Open（毫秒）
  halfOpenRequests: number;  // Half-Open 状态下允许通过的请求数
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failureCount: number = 0;
  private successCount: number = 0;
  private nextAttemptAt: number = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.Open) {
      if (Date.now() < this.nextAttemptAt) {
        throw new CircuitOpenError(`Circuit breaker "${this.name}" is OPEN`);
      }
      this.state = CircuitState.HalfOpen;
      this.successCount = 0;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }

  private onSuccess() {
    if (this.state === CircuitState.HalfOpen) {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenRequests) {
        this.state = CircuitState.Closed;
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure() {
    this.failureCount++;

    if (
      this.state === CircuitState.HalfOpen ||
      this.failureCount >= this.options.failureThreshold
    ) {
      this.state = CircuitState.Open;
      this.nextAttemptAt = Date.now() + this.options.resetTimeout;
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
```

### 集成到 JWKS 缓存服务

```typescript
// auth/jwks-cache.service.ts（集成熔断器）
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { importJWK, KeyLike } from 'jose';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

interface CachedKey {
  key: KeyLike;
  expiresAt: number;
}

@Injectable()
export class JwksCacheService implements OnModuleInit {
  private readonly logger = new Logger(JwksCacheService.name);
  private readonly keyCache = new Map<string, CachedKey>();
  private fetchingPromise: Promise<void> | null = null;

  private readonly jwksUri: string;
  private readonly BASE_TTL_MS = 60 * 60 * 1000;
  private readonly JITTER_MS = 15 * 60 * 1000;

  // 熔断器配置：连续 5 次失败触发熔断，30 秒后进入 Half-Open
  private readonly breaker = new CircuitBreaker('JWKS', {
    failureThreshold: 5,
    resetTimeout: 30_000,
    halfOpenRequests: 2,
  });

  constructor(private readonly config: ConfigService) {
    this.jwksUri = this.config.getOrThrow<string>('JWKS_URI');
  }

  async onModuleInit() {
    await this.refreshKeys().catch((err) => {
      this.logger.warn('Failed to prefetch JWKS on startup', err.message);
    });
  }

  async getKey(kid: string): Promise<KeyLike | null> {
    const cached = this.keyCache.get(kid);

    if (cached && Date.now() < cached.expiresAt) {
      return cached.key;
    }

    if (!this.fetchingPromise) {
      this.fetchingPromise = this.safeRefreshKeys().finally(() => {
        this.fetchingPromise = null;
      });
    }

    try {
      await this.fetchingPromise;
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        // 降级：使用过期的公钥
        const stale = this.keyCache.get(kid);
        if (stale) {
          this.logger.warn(
            `Circuit is OPEN, using stale key kid=${kid} (expired ${Math.round((Date.now() - stale.expiresAt) / 1000)}s ago)`
          );
          return stale.key;
        }
        throw new ServiceUnavailableException('Authentication service is unavailable');
      }
      throw err;
    }

    return this.keyCache.get(kid)?.key ?? null;
  }

  private async safeRefreshKeys(): Promise<void> {
    try {
      await this.breaker.execute(() => this.refreshKeys());
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        this.logger.warn(`JWKS refresh skipped: ${err.message}`);
        throw err;
      }
      this.logger.error('Failed to refresh JWKS', err);
      throw err;
    }
  }

  private async refreshKeys(): Promise<void> {
    const response = await fetch(this.jwksUri, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`JWKS fetch failed: ${response.status}`);
    }

    const jwks: { keys: JsonWebKey[] } = await response.json();

    for (const jwk of jwks.keys) {
      if (!jwk.kid || jwk.use !== 'sig') continue;

      try {
        const key = (await importJWK(jwk)) as KeyLike;
        this.keyCache.set(jwk.kid, {
          key,
          expiresAt: Date.now() + this.computeTTL(),
        });
      } catch (err) {
        this.logger.warn(`Failed to import JWK kid=${jwk.kid}`, err);
      }
    }
  }

  private computeTTL(): number {
    const jitter = (Math.random() - 0.5) * 2 * this.JITTER_MS;
    return Math.max(this.BASE_TTL_MS + jitter, 30 * 60 * 1000);
  }
}
```

**降级策略**：

- **激进策略**：熔断器打开时直接返回 502，不使用过期公钥。适合安全敏感型业务（金融、医疗）。
- **保守策略**：使用过期公钥继续验证 Token。适合体验优先型业务（电商、内容），但需设置降级时长上限。

## JWT 验证中间件完整实现

### JWT 验证服务

```typescript
// auth/jwt-verify.service.ts
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, JWTPayload } from 'jose';
import { JwksCacheService } from './jwks-cache.service';

export interface GatewayTokenPayload extends JWTPayload {
  sub: string;
  email?: string;
  role?: string;
  scope?: string;
  jti?: string;
}

@Injectable()
export class JwtVerifyService {
  private readonly logger = new Logger(JwtVerifyService.name);
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly jwksCache: JwksCacheService,
    private readonly config: ConfigService
  ) {
    this.issuer = this.config.getOrThrow<string>('JWT_ISSUER');
    this.audience = this.config.getOrThrow<string>('JWT_AUDIENCE');
  }

  async verify(token: string): Promise<GatewayTokenPayload> {
    const kid = this.extractKid(token);

    if (!kid) {
      throw new UnauthorizedException('Missing kid in token header');
    }

    const publicKey = await this.jwksCache.getKey(kid);

    if (!publicKey) {
      throw new UnauthorizedException(`Unknown key id: ${kid}`);
    }

    try {
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
      });

      return payload as GatewayTokenPayload;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.debug(`JWT verification failed: ${errorMessage}`);
      throw new UnauthorizedException(this.mapJwtError(errorMessage));
    }
  }

  private extractKid(token: string): string | undefined {
    try {
      const [headerB64] = token.split('.');
      const header = JSON.parse(
        Buffer.from(headerB64, 'base64url').toString('utf-8')
      );
      return header.kid;
    } catch {
      return undefined;
    }
  }

  private mapJwtError(message: string): string {
    if (message.includes('expired')) return 'Access token is expired';
    if (message.includes('not before')) return 'Token is not yet valid';
    if (message.includes('issuer')) return 'Invalid token issuer';
    if (message.includes('audience')) return 'Invalid token audience';
    if (message.includes('signature')) return 'Invalid token signature';
    return 'Invalid access token';
  }
}
```

### JWT 认证守卫

```typescript
// auth/jwt-auth.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtVerifyService, GatewayTokenPayload } from './jwt-verify.service';
import { IS_PUBLIC_KEY } from './public.decorator';

declare module 'express' {
  interface Request {
    user?: GatewayTokenPayload;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtVerify: JwtVerifyService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    request.user = await this.jwtVerify.verify(token);
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    const cookieToken = request.cookies?.access_token;
    if (cookieToken) {
      return cookieToken;
    }

    return undefined;
  }
}
```

### @CurrentUser() 装饰器

```typescript
// auth/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { GatewayTokenPayload } from './jwt-verify.service';

export const CurrentUser = createParamDecorator(
  (data: keyof GatewayTokenPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as GatewayTokenPayload;

    return data ? user?.[data] : user;
  }
);
```

## AuthModule 注册

```typescript
// auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwksCacheService } from './jwks-cache.service';
import { JwtVerifyService } from './jwt-verify.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  providers: [JwksCacheService, JwtVerifyService, JwtAuthGuard],
  exports: [JwksCacheService, JwtVerifyService, JwtAuthGuard],
})
export class AuthModule {}
```

## 密钥滚动（Key Rotation）处理

### 滚动期间的兼容性问题

密钥轮换期间，会有一段时间两把密钥同时有效：

- 旧密钥颁发的 Token → 用缓存中的旧公钥验证
- 新密钥颁发的 Token → 用缓存中的新公钥验证

### 处理未知 kid

如果网关缓存中没有某个 `kid`，可能是密钥刚刚轮换。应对策略：**强制刷新一次 JWKS**，刷新后仍找不到才判定为无效。

## 常见问题与解决方案

**问题一：Token 中没有 kid 字段**

原因：颁发 Token 时没有设置 `kid`，或使用对称密钥（HMAC）。建议在颁发 Token 时始终包含 `kid`。

**问题二：JWKS 端点返回 5xx 错误**

熔断器开始计数，连续 5 次失败后触发熔断。熔断期间使用降级策略，30 秒后进入 Half-Open 状态试探。

**问题三：多个网关实例的公钥缓存不一致**

密钥轮换时旧密钥保留在 JWKS 中至少一个缓存 TTL 周期。可将公钥缓存移到 Redis，所有实例共享。

## 本篇小结

本篇实现了 API 网关的核心 JWT 验证逻辑：

**核心要点**：

- JWKS 端点用于分发公钥，`kid` 字段是公钥的唯一标识
- 公钥必须缓存在内存中，避免每次验证都请求 JWKS 端点
- 通过"共享 Promise"实现 Mutex，防止并发下的重复 JWKS 请求（缓存击穿）
- 随机 TTL 抖动避免多个缓存条目同时失效（缓存雪崩）
- 熔断器（Closed → Open → Half-Open）保护网关在认证服务不可用时快速失败
- 熔断期间可降级使用过期公钥，权衡安全性和可用性

**下一篇**：将实现权限检查守卫，包括基于角色的 RBAC 授权、OAuth2 Scope 验证，以及如何通过自定义装饰器灵活地为路由配置权限要求。
