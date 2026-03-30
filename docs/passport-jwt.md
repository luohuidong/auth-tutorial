# Passport JWT 策略

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 理解 Passport.js 在 NestJS 中的工作原理，以及 Strategy、Guard、Decorator 三者如何协作
- 实现一个完整的 JWT 策略（`JwtStrategy`），整合 Token 提取、签名验证、黑名单检查
- 掌握多种 Token 提取方式（Authorization Header、Cookie、多来源自定义提取器）
- 实现优雅的错误处理，为不同的失败场景返回恰当的错误信息
- 创建 `@CurrentUser()` 等自定义装饰器，让认证信息的使用更简洁
- 将模块三所有已学内容整合，构建一个完整、安全、可扩展的 JWT 认证系统

### 重点与难点

**重点**：

- Passport `Strategy` 的 `validate()` 方法——它的入参、出参和调用时机
- `AuthGuard` 与 `@UseGuards()` 的配合——如何在路由级别选择不同的认证策略
- `ExtractJwt` 工具函数与自定义提取器——如何从请求中安全地提取 Token

**难点**：

- 理解 Passport 的"管道"模型：请求如何从提取 Token 流转到注入 `user` 对象的全过程
- 在 Passport 策略中注入其他 NestJS 服务（如黑名单服务），理解依赖注入与 Passport 的关系
- 公开端点（不需要认证）如何标记，以及如何在 Guard 中识别并跳过验证

## Passport.js 的工作原理

在开始写 JWT 策略之前，我们需要理解 Passport.js 在 NestJS 中的角色。如果你已经在模块二中接触过 Passport Local 策略，这里的概念会很熟悉，但 JWT 策略在某些细节上有所不同。

### 核心概念回顾

Passport.js 是一个 Node.js 认证中间件，它的核心理念是：**将认证逻辑封装为"策略"（Strategy）**，让不同的认证方式（本地用户名密码、JWT、OAuth2、Google 登录等）可以用统一的接口接入应用。

在 NestJS 中，Passport 的使用涉及三个概念：

```mermaid
graph LR
    subgraph "Route Handler 层"
        CONTROLLER["Controller 方法"]
    end
    subgraph "Guard 层"
        GUARD["AuthGuard（如 JwtAuthGuard）\n决定是否允许请求通过"]
    end
    subgraph "Strategy 层"
        STRATEGY["JwtStrategy\n实际的认证逻辑"]
    end
    subgraph "Request 对象"
        USER["req.user = 经过验证的用户信息"]
    end

    REQUEST["HTTP 请求"] --> GUARD
    GUARD -->|"调用 strategy.authenticate()"| STRATEGY
    STRATEGY -->|"validate() 返回用户信息"| USER
    GUARD -->|"认证成功"| CONTROLLER
    CONTROLLER -->|"@CurrentUser() 获取"| USER
```

**Strategy（策略）**：包含具体的认证逻辑——如何从请求中提取凭证、如何验证凭证的有效性、验证成功后返回什么用户信息。

**Guard（守卫）**：实现 `CanActivate` 接口，在请求到达 Controller 前运行。`@nestjs/passport` 提供的 `AuthGuard()` 工厂函数会创建一个 Guard，内部调用对应策略的 `authenticate()` 方法。

**req.user**：认证成功后，Strategy 的 `validate()` 方法返回的对象会被挂载到 `req.user` 上，Controller 可以通过自定义装饰器获取。

### JWT 策略与 Local 策略的区别

| 维度            | Local 策略                       | JWT 策略                                |
| --------------- | -------------------------------- | --------------------------------------- |
| 触发时机        | 用户名密码登录时                 | 每次需要认证的 API 请求                 |
| 输入            | 请求 Body 中的 username/password | 请求 Header/Cookie 中的 JWT             |
| 验证方式        | 查询数据库 + 验证密码哈希        | 验证 JWT 签名 + 检查过期                |
| validate() 入参 | username, password               | JWT Payload（已解码）                   |
| 是否查数据库    | 是（查用户）                     | 可选（通常从 Payload 直接获取用户信息） |

**关键差异**：JWT 策略的 `validate()` 方法接收的是**已经过 Passport 解码的 Payload**，而不是原始 Token 字符串。Passport 会先用配置好的密钥验证签名，再将解码后的 Payload 传给 `validate()`。

## 安装依赖

```plaintext
pnpm add passport passport-jwt @nestjs/passport
pnpm add -D @types/passport-jwt
```

依赖说明：

- `passport`：Passport.js 核心库
- `passport-jwt`：Passport 的 JWT 策略实现，提供 `ExtractJwt` 工具和 `Strategy` 类
- `@nestjs/passport`：NestJS 对 Passport 的封装，提供 `PassportModule`、`AuthGuard` 等
- `@types/passport-jwt`：TypeScript 类型定义

## 实现 JWT 策略

### 基础 JwtStrategy

```typescript
// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AccessTokenPayload } from '../../jwt/jwt.types';
import { JwtBlacklistService } from '../jwt-blacklist.service';

/**
 * JWT 认证策略
 *
 * 认证流程：
 * 1. 从请求中提取 JWT（ExtractJwt 负责）
 * 2. 验证签名 + 过期时间（passport-jwt 自动处理）
 * 3. 检查黑名单（validate() 中手动检查）
 * 4. 将用户信息注入 req.user
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly blacklist: JwtBlacklistService
  ) {
    // 从 base64 编码的环境变量还原 PEM 格式公钥
    const publicKey = Buffer.from(
      config.getOrThrow<string>('JWT_PUBLIC_KEY'),
      'base64'
    ).toString('utf-8');

    super({
      // Token 提取方式：从 Authorization: Bearer <token> Header 提取
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // 不忽略过期：过期的 Token 会直接被 passport-jwt 拒绝，validate() 不会被调用
      ignoreExpiration: false,

      // 用于验证 JWT 签名的公钥
      secretOrKey: publicKey,

      // 算法白名单：明确指定只接受 RS256，防止算法混淆攻击
      algorithms: ['RS256'],

      // 验证 iss 声明
      issuer: config.getOrThrow<string>('JWT_ISSUER'),
    });
  }

  /**
   * validate() 在签名验证通过后被调用
   *
   * @param payload 已解码的 JWT Payload（由 passport-jwt 解码，已验证签名）
   * @returns 返回值会被挂载到 req.user 上
   * @throws UnauthorizedException 如果 Token 已被加入黑名单
   */
  async validate(payload: AccessTokenPayload): Promise<AccessTokenPayload> {
    // 检查 jti 是否在黑名单中
    if (payload.jti) {
      const revoked = await this.blacklist.isBlacklisted(payload.jti);
      if (revoked) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    // 返回值会成为 req.user 的值
    // 这里直接返回 Payload，也可以根据 payload.sub 查询完整的用户信息
    return payload;
  }
}
```

### validate() 的设计决策

`validate()` 的返回值会成为 `req.user`，这里有两种常见设计：

**方案 A：直接返回 Payload（推荐）**

```typescript
async validate(payload: AccessTokenPayload): Promise<AccessTokenPayload> {
  // 不查数据库，直接返回 Payload
  return payload;
}
```

优点：无数据库查询，性能最优。每次 API 请求的 `req.user` 包含 userId、email、role 等基本信息，足以满足大多数业务逻辑。

缺点：用户信息是 Token 颁发时的快照，可能不是最新的（如邮箱修改后，旧 Token 中还是旧邮箱）。

**方案 B：从数据库查询最新用户信息**

```typescript
async validate(payload: AccessTokenPayload): Promise<User> {
  const user = await this.usersService.findById(payload.sub);
  if (!user || user.isBanned) {
    throw new UnauthorizedException();
  }
  return user; // req.user 是最新的数据库用户对象
}
```

优点：用户信息始终最新，可以在这里做额外检查（如账号封禁标记）。

缺点：每次 API 请求多一次数据库查询，高 QPS 场景可能成为瓶颈（可以用 Redis 缓存缓解）。

**本教程的选择**：方案 A（直接返回 Payload）。账号封禁通过 Token Version 机制处理（见上一篇），不在 `validate()` 中查数据库。

## Token 提取方式

`ExtractJwt` 是 `passport-jwt` 提供的工具类，提供了多种 Token 提取方式。

### 从 Authorization Header 提取（Bearer Token）

```typescript
jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken();
```

对应的请求格式：

```http
GET /api/profile HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

这是 REST API 中最标准的 JWT 传递方式，也是本教程的主要选择。

### 从 Cookie 提取

```typescript
jwtFromRequest: ExtractJwt.fromExtractors([
  (req) => req?.cookies?.['accessToken'] ?? null,
]);
```

对应的请求格式：

```http
GET /api/profile HTTP/1.1
Cookie: accessToken=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

注意：从 Cookie 提取 Access Token 意味着 Cookie 不能设置 `HttpOnly`（因为前端需要在特定场景下访问）。这会带来 XSS 风险。推荐的方案是：**Access Token 放在内存中，通过 Authorization Header 传递，而不是 Cookie**。

### 自定义多来源提取器

在某些场景下（如同时支持移动端 Bearer Token 和 Web 端 Cookie），可以使用多个提取器，按顺序尝试：

```typescript
import { ExtractJwt, JwtFromRequestFunction } from 'passport-jwt';
import { Request } from 'express';

/**
 * 创建一个多来源 Token 提取器
 * 按顺序尝试各个来源，返回第一个成功提取到的 Token
 */
function createMultiExtractor(): JwtFromRequestFunction {
  const extractors: JwtFromRequestFunction[] = [
    // 来源 1：Authorization: Bearer <token>（API 客户端、移动端常用）
    ExtractJwt.fromAuthHeaderAsBearerToken(),
    // 来源 2：自定义 Header（某些内部服务使用）
    ExtractJwt.fromHeader('x-access-token'),
  ];

  return (req: Request): string | null => {
    for (const extractor of extractors) {
      const token = extractor(req);
      if (token) return token;
    }
    return null;
  };
}
```

### 安全提取注意事项

无论使用哪种提取方式，提取器应当：

1. 返回 `null` 而不是抛出异常（未找到 Token 时）
2. 不对 Token 内容进行任何验证（验证由 passport-jwt 完成）
3. 注意来源的可信度——Cookie 需要配合 SameSite 和 CSRF 防护

## 创建 JWT Auth Guard

### 基础 JwtAuthGuard

```typescript
// src/auth/guards/jwt-auth.guard.ts
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * 在每次请求前执行，决定是否允许访问
   */
  canActivate(context: ExecutionContext) {
    // 检查路由是否标记为公开端点（@Public() 装饰器）
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      // 公开端点：直接放行，不进行 JWT 验证
      return true;
    }

    // 非公开端点：调用父类的 canActivate，触发 JWT 验证流程
    return super.canActivate(context);
  }

  /**
   * 处理认证请求的结果
   * 重写此方法可以自定义错误响应
   */
  handleRequest<TUser = any>(
    err: Error | null,
    user: TUser | false,
    info: Error | null
  ): TUser {
    // err：策略执行过程中的系统错误
    // user：validate() 的返回值（false 表示认证失败）
    // info：认证失败的原因（TokenExpiredError、JsonWebTokenError 等）

    if (err || !user) {
      if (info instanceof TokenExpiredError) {
        throw new UnauthorizedException('Access token has expired');
      }
      if (info instanceof JsonWebTokenError) {
        throw new UnauthorizedException('Invalid access token');
      }
      throw new UnauthorizedException(
        err?.message ?? 'Authentication required'
      );
    }

    return user;
  }
}
```

### 全局注册 JwtAuthGuard

将 `JwtAuthGuard` 注册为全局 Guard，这样所有路由默认都需要 JWT 认证，公开端点用 `@Public()` 装饰器豁免：

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  // ...
})
export class AppModule {}
```

## 自定义装饰器

### @Public() 装饰器：标记公开端点

```typescript
// src/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记路由为公开端点，跳过 JWT 认证
 *
 * @example
 * @Public()
 * @Post('login')
 * async login(@Body() dto: LoginDto) { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### @CurrentUser() 装饰器：获取当前登录用户

```typescript
// src/auth/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AccessTokenPayload } from '../../jwt/jwt.types';

/**
 * 从 req.user 中获取当前登录用户信息
 *
 * Passport 认证成功后，validate() 返回的值会被挂载到 req.user
 * 此装饰器让 Controller 方法可以方便地获取这些信息
 *
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: AccessTokenPayload) {
 *   return { userId: user.sub, email: user.email };
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AccessTokenPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AccessTokenPayload;

    if (!user) return null;

    // 如果指定了字段名，只返回该字段
    return data ? user[data] : user;
  }
);
```

使用示例：

```typescript
// 获取完整的用户 Payload
@Get('profile')
getProfile(@CurrentUser() user: AccessTokenPayload) {
  return { userId: user.sub, role: user.role };
}

// 只获取 userId
@Delete('account')
async deleteAccount(@CurrentUser('sub') userId: string) {
  await this.usersService.delete(userId);
}
```

### @Roles() 装饰器：基于角色的访问控制

```typescript
// src/auth/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export type UserRole = 'user' | 'admin' | 'moderator';

export const ROLES_KEY = 'roles';

/**
 * 指定访问该路由所需的角色
 *
 * @example
 * @Roles('admin')
 * @Get('admin/users')
 * getAllUsers() { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

配合 Roles Guard 使用：

```typescript
// src/auth/guards/roles.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import { AccessTokenPayload } from '../../jwt/jwt.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );

    // 没有 @Roles() 装饰器：不限制角色，只要认证通过即可
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AccessTokenPayload;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const hasRole = requiredRoles.includes(user.role as UserRole);
    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}`
      );
    }

    return true;
  }
}
```

全局注册 `RolesGuard`（在 `JwtAuthGuard` 之后运行）：

```typescript
// src/app.module.ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },   // 先认证
  { provide: APP_GUARD, useClass: RolesGuard },     // 再授权
],
```

## 模块整合

将所有组件整合到 `AuthModule` 中：

```typescript
// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { JwtBlacklistService } from './jwt-blacklist.service';
import { JwtBloomFilterService } from './jwt-bloom-filter.service';
import { TokenService } from './token.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RefreshTokenRepository } from './refresh-token.repository';
import { AppJwtModule } from '../jwt/jwt.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AppJwtModule, // 提供 JwtService
  ],
  providers: [
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    JwtBlacklistService,
    JwtBloomFilterService,
    TokenService,
    AuthService,
    RefreshTokenRepository,
  ],
  controllers: [AuthController],
  exports: [JwtBlacklistService, TokenService, AuthService],
})
export class AuthModule {}
```

## 完整的 Controller 示例

```typescript
// src/auth/auth.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { AccessTokenPayload } from '../jwt/jwt.types';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  /**
   * 登录端点：不需要 JWT 认证
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const user = await this.authService.validateCredentials(
      body.email,
      body.password
    );

    const { accessToken, refreshToken } = await this.authService.issueTokens(
      user.id,
      req.headers['user-agent'],
      req.ip
    );

    // Refresh Token 通过 HttpOnly Cookie 下发
    const ttlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
    });

    // Access Token 通过 JSON 响应体返回，由前端存入内存
    return { accessToken };
  }

  /**
   * 刷新端点：不需要 JWT 认证（因为 Access Token 可能已经过期）
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const refreshToken = req.cookies['refreshToken'] as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const { accessToken, refreshToken: newRefreshToken } =
      await this.authService.refreshTokens(
        refreshToken,
        req.headers['user-agent'],
        req.ip
      );

    const ttlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
    });

    return { accessToken };
  }

  /**
   * 注销端点：需要 JWT 认证（知道是谁在注销）
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: AccessTokenPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const refreshToken = req.cookies['refreshToken'] as string | undefined;

    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }

    // 可选：将当前 Access Token 加入黑名单
    if (user.jti && user.exp) {
      await this.authService.blacklistAccessToken(user.jti, user.exp);
    }

    // 清除 Refresh Token Cookie
    res.clearCookie('refreshToken', {
      path: '/auth/refresh',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return { message: 'Logged out successfully' };
  }

  /**
   * 获取当前用户信息：需要 JWT 认证（全局 Guard 自动生效）
   */
  @Get('me')
  getMe(@CurrentUser() user: AccessTokenPayload) {
    return {
      userId: user.sub,
      email: user.email,
      role: user.role,
    };
  }

  /**
   * 管理员专用端点：需要 JWT 认证 + admin 角色
   */
  @Roles('admin')
  @Get('admin/stats')
  getAdminStats() {
    return { totalUsers: 42, activeTokens: 1337 };
  }
}
```

## 错误处理的最佳实践

### 统一错误响应格式

NestJS 默认的错误响应格式是：

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

可以通过全局异常过滤器自定义格式：

```typescript
// src/common/filters/http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  path: string;
  timestamp: string;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : typeof exceptionResponse === 'object' &&
            'message' in exceptionResponse
          ? String((exceptionResponse as Record<string, unknown>).message)
          : 'An error occurred';

    const errorBody: ErrorResponse = {
      statusCode: status,
      error: exception.name,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    // 401/403 错误不记录为 Error（是正常的业务逻辑）
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${request.url}`, exception.stack);
    }

    response.status(status).json(errorBody);
  }
}
```

全局注册：

```typescript
// src/main.ts
app.useGlobalFilters(new HttpExceptionFilter());
```

### 不同失败场景的错误响应

JWT 认证可能因为多种原因失败，应该给出具体的错误信息（但不能泄露安全信息）：

| 失败原因             | HTTP 状态 | 响应 message                   |
| -------------------- | --------- | ------------------------------ |
| 没有携带 Token       | 401       | "Authentication required"      |
| Token 格式错误       | 401       | "Invalid access token"         |
| Token 签名无效       | 401       | "Invalid access token"         |
| Token 已过期         | 401       | "Access token has expired"     |
| Token 在黑名单中     | 401       | "Token has been revoked"       |
| Token 有效但角色不够 | 403       | "Forbidden: insufficient role" |

注意：不要在错误信息中暴露过多细节（如"签名使用了错误的密钥"），这会帮助攻击者分析系统。

### 可选认证场景

有时候端点需要"如果有 Token 就验证，没有也允许通过"（如获取文章列表，登录用户可以看到更多内容）。可以自定义一个可选认证 Guard：

```typescript
// src/auth/guards/optional-jwt-auth.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  /**
   * 重写 handleRequest，Token 无效时不抛出异常而是返回 null
   */
  handleRequest<TUser = any>(err: any, user: TUser | false): TUser | null {
    // 忽略所有错误，返回 user（可能是 null/false）
    return user || null;
  }
}
```

使用：

```typescript
@UseGuards(OptionalJwtAuthGuard)
@Get('posts')
getPosts(@CurrentUser() user: AccessTokenPayload | null) {
  if (user) {
    return this.postsService.getPostsForUser(user.sub);
  }
  return this.postsService.getPublicPosts();
}
```

## 完整的请求验证流程

将本模块所有内容整合，来看一个完整的 API 请求验证流程：

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant Guard as JwtAuthGuard
    participant Strategy as JwtStrategy
    participant BL as JwtBlacklistService
    participant Bloom as BloomFilter
    participant Redis as Redis
    participant Handler as Route Handler

    Client->>Guard: GET /api/profile\nAuthorization: Bearer <token>

    Guard->>Guard: 检查 @Public() 元数据\n（非公开端点）

    Guard->>Strategy: canActivate → authenticate()

    Strategy->>Strategy: ExtractJwt 从 Header 提取 Token

    Strategy->>Strategy: 验证签名（RSA 公钥）\n检查 exp、iss 声明

    alt Token 无效或过期
        Strategy-->>Guard: null / 异常
        Guard-->>Client: 401 Invalid/Expired token
    end

    Strategy->>BL: validate(payload) → isBlacklisted(jti)

    BL->>Bloom: mightExist(jti)

    alt 布隆过滤器返回"一定不存在"
        Bloom-->>BL: false
        BL-->>Strategy: false（未黑名单）
    else 布隆过滤器返回"可能存在"
        Bloom-->>BL: true
        BL->>Redis: GET jwt-blacklist:{jti}
        Redis-->>BL: null（不在黑名单）
        BL-->>Strategy: false（未黑名单）
    end

    Strategy-->>Guard: payload（作为 req.user）

    Guard->>Guard: RolesGuard 检查角色

    Guard-->>Handler: canActivate = true

    Handler->>Handler: @CurrentUser() 获取 req.user
    Handler-->>Client: 200 OK + 响应数据
```

## 测试 JWT 认证

### 单元测试 JwtStrategy

```typescript
// src/auth/strategies/jwt.strategy.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { JwtBlacklistService } from '../jwt-blacklist.service';
import { ConfigService } from '@nestjs/config';
import { AccessTokenPayload } from '../../jwt/jwt.types';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let blacklist: jest.Mocked<JwtBlacklistService>;

  const mockPayload: AccessTokenPayload = {
    sub: 'user-123',
    email: 'alice@example.com',
    role: 'user',
    jti: 'jti-abc-123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    iss: 'https://auth.example.com',
  };

  beforeEach(async () => {
    const mockBlacklist = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
    };

    const mockConfigService = {
      getOrThrow: jest.fn((key: string) => {
        const config: Record<string, string> = {
          JWT_PUBLIC_KEY: Buffer.from('mock-public-key').toString('base64'),
          JWT_ISSUER: 'https://auth.example.com',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: JwtBlacklistService, useValue: mockBlacklist },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    blacklist = module.get(JwtBlacklistService);
  });

  it('应该在 Token 有效时返回 Payload', async () => {
    const result = await strategy.validate(mockPayload);
    expect(result).toEqual(mockPayload);
  });

  it('应该在 Token 被加入黑名单时抛出 UnauthorizedException', async () => {
    blacklist.isBlacklisted.mockResolvedValue(true);

    await expect(strategy.validate(mockPayload)).rejects.toThrow(
      UnauthorizedException
    );
  });

  it('应该在没有 jti 时跳过黑名单检查', async () => {
    const payloadWithoutJti = { ...mockPayload };
    delete (payloadWithoutJti as Partial<AccessTokenPayload>).jti;

    const result = await strategy.validate(
      payloadWithoutJti as AccessTokenPayload
    );
    expect(result).toEqual(payloadWithoutJti);
    expect(blacklist.isBlacklisted).not.toHaveBeenCalled();
  });
});
```

### E2E 测试认证流程

```typescript
// test/auth.e2e-spec.ts
import * as request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // 注意：测试中需要配置和主应用相同的中间件（cookie-parser 等）
    await app.init();
  });

  it('应该能够登录并获取 Access Token', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'Test@1234' })
      .expect(200);

    expect(response.body).toHaveProperty('accessToken');
    accessToken = response.body.accessToken;
  });

  it('应该能够用有效 Token 访问受保护端点', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('应该拒绝无 Token 的受保护端点请求', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('应该拒绝格式错误的 Token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-valid-jwt')
      .expect(401);
  });

  afterAll(async () => {
    await app.close();
  });
});
```

## 常见问题与解决方案

### 问题一：Strategy 中注入的服务报 undefined

**原因**：Passport Strategy 的 `super()` 调用必须在 `constructor` 的第一行（JavaScript 的语言限制），但 NestJS 依赖注入的参数（如 `config`）需要先使用，用于传入 `super()`。

**症状**：`this.blacklist` 等注入的服务在 `validate()` 中报 undefined。

**解决**：将需要在 `super()` 中使用的参数（如 ConfigService）列在 `constructor` 参数的前面，确保它们可以在 `super()` 调用前使用：

```typescript
// 正确：ConfigService 先列出，然后才在 super() 中使用
constructor(config: ConfigService, private readonly blacklist: JwtBlacklistService) {
  super({
    secretOrKey: config.getOrThrow('JWT_PUBLIC_KEY'),
    // ...
  });
}
```

注意：`private readonly blacklist` 的声明会让 TypeScript 自动将参数赋值给 `this.blacklist`，这发生在 `super()` 调用之后，在 `validate()` 调用时 `this.blacklist` 已经可用。

### 问题二：@Public() 装饰器在子路由上不生效

**原因**：`Reflector.getAllAndOverride()` 先检查 Handler（方法）级别的元数据，再检查 Class 级别。如果 Controller 类设置了某个元数据，但方法级别的 `@Public()` 应该覆盖它，需要确保使用 `getAllAndOverride` 而不是 `get`。

**解决**：上面的实现中已使用 `getAllAndOverride`，它会优先取更具体（方法级别）的元数据。如果还有问题，检查是否有多个 Guard 层的冲突。

### 问题三：Cookie 中的 Refresh Token 没有被发送

**原因**：Cookie 的 `path` 设置为 `/auth/refresh`，导致浏览器只在访问该路径时自动携带。如果刷新请求的路径不完全匹配，Cookie 不会发送。

**解决**：确认刷新端点路径与 Cookie 的 `path` 完全一致（包括前缀，如全局设置了 `/api` 前缀，Cookie `path` 也需要调整）：

```typescript
// 如果全局 prefix 是 /api，刷新端点实际路径是 /api/auth/refresh
res.cookie('refreshToken', token, {
  path: '/api/auth/refresh', // 需要包含前缀
  // ...
});
```

### 问题四：如何测试受 @Roles() 保护的端点？

在 E2E 测试中，可以预先在数据库中创建对应角色的用户，或者 Mock `RolesGuard`：

```typescript
// 测试中 Mock RolesGuard，让所有请求都通过角色验证
const moduleFixture = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideGuard(RolesGuard)
  .useValue({ canActivate: () => true })
  .compile();
```

或者在测试数据库中创建 admin 用户，用该用户的凭证获取 Token 后测试 admin 端点（推荐，更接近真实场景）。

### 问题五：JWT 策略和 Session 策略如何共存？

如果系统同时支持 Session 认证（旧功能）和 JWT 认证（新功能），可以在 Guard 中混合使用：

```typescript
@Injectable()
export class FlexibleAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtGuard: JwtAuthGuard,
    private readonly sessionGuard: SessionAuthGuard
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // 如果有 Authorization Header，使用 JWT 认证
    if (request.headers.authorization?.startsWith('Bearer ')) {
      return this.jwtGuard.canActivate(context) as Promise<boolean>;
    }

    // 否则尝试 Session 认证
    return this.sessionGuard.canActivate(context) as Promise<boolean>;
  }
}
```

## 本篇小结

本篇是模块三的收官，将前三篇的所有理论和设计完整地落地到 NestJS 代码：

**Passport Strategy**：`JwtStrategy` 继承自 `PassportStrategy(Strategy, 'jwt')`。在 `super()` 中配置 Token 提取方式、公钥和算法白名单；在 `validate()` 中接收已解码的 Payload，执行额外验证（黑名单检查），返回值会挂载到 `req.user`。

**AuthGuard**：`JwtAuthGuard` 扩展了 `AuthGuard('jwt')`，重写 `canActivate` 支持 `@Public()` 豁免，重写 `handleRequest` 提供有意义的错误信息（区分过期、无效签名、被撤销等场景）。

**全局注册**：通过 `APP_GUARD` 将 Guard 全局注册，默认保护所有路由，免维护的方式大幅减少遗漏认证的风险。

**自定义装饰器**：

- `@Public()`：标记豁免认证的端点（登录、注册、刷新）
- `@CurrentUser()`：从 `req.user` 提取当前用户信息，支持选取特定字段
- `@Roles()`：配合 `RolesGuard` 实现基于角色的细粒度访问控制

**错误处理**：通过重写 `handleRequest` 和全局异常过滤器，为不同的认证失败场景返回明确且安全的错误响应。

至此，模块三的所有内容都已讲完：从 JWT 的理论原理，到双令牌策略的完整实现，到按需撤销的黑名单机制，最后到 Passport JWT 策略的工程落地。这套 JWT 认证体系将作为后续模块（尤其是模块四 OIDC 授权服务器）的基础，继续在更复杂的场景中发挥作用。
