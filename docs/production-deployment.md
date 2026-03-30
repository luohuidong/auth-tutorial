# 生产部署

## 本篇导读

### 核心目标

学完本篇后，你将能够：

- 为认证服务编写生产级 Dockerfile，理解多阶段构建（Multi-stage Build）的设计意图
- 用 Docker Compose 编排认证服务的完整运行环境（NestJS + PostgreSQL + Redis）
- 理解 Kubernetes 的核心概念（Deployment、Service、ConfigMap、Secret），并将认证服务部署到 K8s 集群
- 设计并实现 CI/CD 流水线（GitHub Actions），包括代码检查、测试、镜像构建和自动部署
- 搭建基于 Prometheus + Grafana 的监控告警体系，监控认证服务的关键指标
- 掌握认证服务在生产环境中的数据库运维策略：迁移、备份与恢复
- 实现健康检查端点（Health Check），支持 K8s 的存活探测（Liveness）和就绪探测（Readiness）
- 掌握常见故障的排查思路和步骤

### 重点与难点

**重点**：

- 多阶段 Docker 构建——开发依赖不进入生产镜像，最小化镜像体积和攻击面
- K8s 中 Secret 和 ConfigMap 的使用——敏感配置和非敏感配置的分离存储
- 健康检查的两种探测——Liveness（存活）和 Readiness（就绪）的区别与实现
- 生产数据库迁移的安全策略——零停机迁移的设计原则

**难点**：

- K8s 中的水平扩缩容（HPA）在认证服务场景下的特殊考量——Session 和 Redis 连接池的配置
- 监控指标的选取——在认证系统中，什么是真正值得告警的指标，什么是噪音
- 蓝绿部署和金丝雀发布在认证服务中的实施——保持 Token 验证的向后兼容性

## 生产环境的核心原则

在动手写配置之前，先建立生产部署的核心认知：

**不可变基础设施（Immutable Infrastructure）**：生产服务器不应该被手动修改。所有变更通过重新部署新版本镜像来完成，而不是 SSH 进去修改配置或代码。这确保了环境的可重现性——你可以在任何时刻销毁并重建相同的环境。

**配置外置（Externalized Configuration）**：代码中不应该包含任何环境相关的配置（数据库地址、密钥、端口号）。所有配置通过环境变量或配置中心注入，同一份代码可以在开发、测试、生产环境运行，只是配置不同。

**最小权限原则（Principle of Least Privilege）**：每个服务只拥有完成其功能所必需的权限，不多也不少。容器不应以 root 运行；数据库账号只有必要的表级权限；对外暴露的端口尽可能少。

**可观测性（Observability）**：生产系统必须能被度量（Metrics）、追踪（Tracing）和记录（Logging）。没有可观测性，出现问题时只能靠猜测。

## Docker 容器化

### 多阶段构建 Dockerfile

```dockerfile
# ──── 阶段一：依赖安装 ─────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# 只复制包管理器相关文件（利用 Docker 层缓存）
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ──── 阶段二：TypeScript 编译 ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 编译 TypeScript 到 JavaScript
RUN pnpm run build

# 删除开发依赖，只保留生产依赖（减小最终镜像体积）
RUN pnpm install --frozen-lockfile --prod

# ──── 阶段三：生产镜像 ─────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# 创建非 root 用户（最小权限原则）
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# 只复制生产所需文件
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

# 切换到非 root 用户
USER appuser

# 声明端口（文档目的，不会实际映射）
EXPOSE 3000

# 健康检查（Docker 层面，K8s 另有健康探测）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
```

**多阶段构建的好处**：

- 开发依赖（TypeScript 编译器、测试框架等）不进入生产镜像
- 典型的 NestJS 应用镜像从 1GB+ 缩小到 200MB 左右
- 攻击面减小：镜像中的软件越少，潜在漏洞越少

### .dockerignore 文件

```plaintext
# .dockerignore
node_modules
dist
.git
.env*
*.md
coverage
.vscode
.idea
```

防止本地的 `node_modules`、环境变量文件等不必要内容被复制进镜像。

### Docker Compose 本地开发与集成测试

```yaml
# docker-compose.yml
version: '3.9'

services:
  auth-service:
    build:
      context: .
      target: production # 使用生产阶段镜像
    ports:
      - '3000:3000'
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://auth_user:secret@postgres:5432/auth_db
      REDIS_URL: redis://redis:6379
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      JWT_MFA_SECRET: ${JWT_MFA_SECRET}
      MFA_ENCRYPTION_KEY: ${MFA_ENCRYPTION_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - auth-network

  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: auth_db
      POSTGRES_USER: auth_user
      POSTGRES_PASSWORD: secret
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U auth_user -d auth_db']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - auth-network

  redis:
    image: redis:8-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --save 60 1 --loglevel warning
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD}', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - auth-network

volumes:
  postgres_data:
  redis_data:

networks:
  auth-network:
    driver: bridge
```

## Kubernetes 部署

### K8s 资源概览

在 K8s 中部署认证服务涉及以下核心资源：

```mermaid
graph TB
    Ingress["Ingress\n（外部流量入口）"] --> Service["Service\n（负载均衡）"]
    Service --> Pod1["Pod 1\n（auth-service）"]
    Service --> Pod2["Pod 2\n（auth-service）"]
    Service --> Pod3["Pod 3\n（auth-service）"]

    HPA["HPA\n（自动扩缩容）"] -.->|"控制副本数"| Deployment["Deployment\n（管理 Pod 副本）"]
    Deployment -.->|"创建"| Pod1
    Deployment -.->|"创建"| Pod2
    Deployment -.->|"创建"| Pod3

    ConfigMap["ConfigMap\n（非敏感配置）"] -.->|"注入"| Pod1
    Secret["Secret\n（敏感配置）"] -.->|"注入"| Pod1
```

### Secret：敏感配置管理

```yaml
# k8s/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: auth-service-secrets
  namespace: auth
type: Opaque
# 值必须是 Base64 编码（kubectl create secret 会自动编码）
# 生产环境：使用 Sealed Secrets 或 AWS Secrets Manager / HashiCorp Vault
stringData:
  JWT_ACCESS_SECRET: 'your-production-jwt-access-secret-at-least-256-bits'
  JWT_REFRESH_SECRET: 'your-production-jwt-refresh-secret-at-least-256-bits'
  JWT_MFA_SECRET: 'your-production-jwt-mfa-secret-at-least-256-bits'
  MFA_ENCRYPTION_KEY: 'your-64-char-hex-aes256-key'
  DATABASE_URL: 'postgresql://auth_user:prod_password@postgres-service:5432/auth_db'
  REDIS_URL: 'redis://:prod_redis_password@redis-service:6379'
  SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/xxx/yyy/zzz'
```

**重要**：`Secret` 对象在 K8s 中只是 Base64 编码（不是加密），直接存入 Git 是不安全的。生产环境应使用：

- **Sealed Secrets**（Bitnami）：加密 Secret 后可以安全存入 Git
- **External Secrets Operator**：直接从 AWS Secrets Manager、HashiCorp Vault 等读取密钥

### ConfigMap：非敏感配置

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-service-config
  namespace: auth
data:
  NODE_ENV: 'production'
  PORT: '3000'
  LOG_LEVEL: 'info'
  BCRYPT_ROUNDS: '12'
  ACCESS_TOKEN_TTL: '900' # 15 分钟（秒）
  REFRESH_TOKEN_TTL: '2592000' # 30 天（秒）
```

### Deployment：应用部署

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
  namespace: auth
  labels:
    app: auth-service
    version: v1.0.0
spec:
  replicas: 3
  selector:
    matchLabels:
      app: auth-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1 # 更新时最多额外增加 1 个 Pod
      maxUnavailable: 0 # 更新时不允许任何 Pod 不可用（零停机更新）
  template:
    metadata:
      labels:
        app: auth-service
      annotations:
        prometheus.io/scrape: 'true'
        prometheus.io/path: '/metrics'
        prometheus.io/port: '3000'
    spec:
      # 优雅终止：给正在处理的请求足够时间完成
      terminationGracePeriodSeconds: 30

      # 安全上下文：以非 root 用户运行
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001

      containers:
        - name: auth-service
          image: your-registry/auth-service:1.0.0
          imagePullPolicy: Always

          ports:
            - containerPort: 3000
              name: http

          # 从 ConfigMap 注入非敏感配置
          envFrom:
            - configMapRef:
                name: auth-service-config
            - secretRef:
                name: auth-service-secrets

          # 资源限制（防止单个 Pod 耗尽节点资源）
          resources:
            requests:
              cpu: '100m' # 0.1 核
              memory: '256Mi'
            limits:
              cpu: '500m' # 0.5 核
              memory: '512Mi'

          # 存活探测：失败则重启 Pod
          livenessProbe:
            httpGet:
              path: /health/liveness
              port: 3000
            initialDelaySeconds: 10 # 启动后 10 秒开始探测
            periodSeconds: 10 # 每 10 秒探测一次
            failureThreshold: 3 # 连续失败 3 次才重启

          # 就绪探测：失败则从 Service 摘除，不再接收流量
          readinessProbe:
            httpGet:
              path: /health/readiness
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3

          # 启动探测：给应用足够时间启动（防止启动慢被误判为不健康）
          startupProbe:
            httpGet:
              path: /health/liveness
              port: 3000
            failureThreshold: 30 # 允许 30 * 2 = 60 秒启动时间
            periodSeconds: 2

      # 镜像拉取密钥（私有仓库需要）
      imagePullSecrets:
        - name: registry-credentials
```

### Service 和 Ingress

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: auth-service
  namespace: auth
spec:
  selector:
    app: auth-service
  ports:
    - port: 80
      targetPort: 3000
      name: http
  type: ClusterIP # 只在集群内部访问，外部通过 Ingress

---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: auth-service-ingress
  namespace: auth
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: 'true'
    nginx.ingress.kubernetes.io/proxy-body-size: '1m'
    # 限流：每个 IP 每秒最多 10 个请求
    nginx.ingress.kubernetes.io/limit-rps: '10'
    nginx.ingress.kubernetes.io/limit-connections: '100'
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
spec:
  tls:
    - hosts:
        - auth.example.com
      secretName: auth-service-tls
  rules:
    - host: auth.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: auth-service
                port:
                  name: http
```

### 水平自动扩缩容（HPA）

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: auth-service-hpa
  namespace: auth
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: auth-service
  minReplicas: 3 # 最少 3 个副本（保证高可用）
  maxReplicas: 20 # 最多扩展到 20 个副本
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70 # CPU 超过 70% 时扩容
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300 # 缩容前等待 5 分钟（防止抖动）
      policies:
        - type: Pods
          value: 1 # 每次最多缩减 1 个 Pod
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Pods
          value: 2 # 每次最多增加 2 个 Pod
          periodSeconds: 30
```

**认证服务扩缩容的注意事项**：

- JWT 是无状态的，多副本扩展完全透明，只要 JWT Secret 一致即可
- Session 数据存储在 Redis（不在内存），多副本之间共享 Session，扩展无问题
- 唯一需要注意的是 Redis 连接池：多副本情况下连接数成倍增长，确保 Redis 的 `maxclients` 配置足够大，或使用连接代理（如 Redis Cluster 或 TwemProxy）

## CI/CD 流水线

### GitHub Actions 工作流

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/auth-service

jobs:
  # ──── 代码检查与测试 ──────────────────────────────────────────────────────
  test:
    name: Lint & Test
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: auth_test
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_password
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:8-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: TypeScript type check
        run: pnpm run type-check

      - name: Lint
        run: pnpm run lint

      - name: Run tests
        run: pnpm run test:cov
        env:
          DATABASE_URL: postgresql://test_user:test_password@localhost:5432/auth_test
          REDIS_URL: redis://localhost:6379
          JWT_ACCESS_SECRET: test-secret-for-ci
          JWT_REFRESH_SECRET: test-refresh-secret
          JWT_MFA_SECRET: test-mfa-secret
          MFA_ENCRYPTION_KEY: ${{ secrets.TEST_MFA_KEY }}

      - name: Upload coverage
        uses: codecov/codecov-action@v4

  # ──── 构建并推送 Docker 镜像 ──────────────────────────────────────────────
  build:
    name: Build & Push Image
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
      image-digest: ${{ steps.build.outputs.digest }}

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=sha-
            type=raw,value=latest

      - name: Build and push
        id: build
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      # 镜像安全扫描（检测已知 CVE 漏洞）
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH
          exit-code: '1' # 发现 CRITICAL/HIGH 漏洞时 CI 失败

      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif

  # ──── 部署到 Kubernetes ───────────────────────────────────────────────────
  deploy:
    name: Deploy to K8s
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    environment: production # 需要手动审批的环境

    steps:
      - uses: actions/checkout@v4

      - name: Set up kubectl
        uses: azure/setup-kubectl@v4

      - name: Configure K8s credentials
        run: |
          mkdir -p ~/.kube
          echo "${{ secrets.KUBECONFIG }}" | base64 -d > ~/.kube/config

      - name: Update image tag in deployment
        run: |
          IMAGE="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ needs.build.outputs.image-digest }}"
          kubectl set image deployment/auth-service auth-service=$IMAGE -n auth

      - name: Wait for rollout
        run: kubectl rollout status deployment/auth-service -n auth --timeout=5m

      - name: Verify deployment health
        run: |
          kubectl get pods -n auth -l app=auth-service
          # 等待就绪
          kubectl wait pods -l app=auth-service -n auth --for=condition=Ready --timeout=2m
```

### 数据库迁移的 CI/CD 集成

数据库迁移是部署流程中最危险的步骤，需要特别谨慎处理：

```yaml
# 在应用部署前执行数据库迁移
migrate:
  name: Database Migration
  runs-on: ubuntu-latest
  needs: build
  if: github.ref == 'refs/heads/main'

  steps:
    - uses: actions/checkout@v4

    - uses: pnpm/action-setup@v3
      with:
        version: 9

    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: 'pnpm'

    - name: Install dependencies
      run: pnpm install --frozen-lockfile

    - name: Run database migrations
      run: pnpm run db:migrate
      env:
        DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
```

**零停机迁移的原则**：

不是所有的数据库迁移都能零停机完成。核心原则是：**新代码和旧代码必须同时兼容迁移中的数据库状态**。

以添加新列为例，错误做法 vs 正确做法：

```plaintext
❌ 错误做法（会导致停机）：
  第一步：ALTER TABLE users ADD COLUMN phone VARCHAR(20) NOT NULL;
  第二步：部署新代码使用 phone 列

  问题：旧代码插入数据时没有 phone 字段，NOT NULL 约束导致插入失败。

✅ 正确做法（零停机，分三步）：

  第一步迁移：ALTER TABLE users ADD COLUMN phone VARCHAR(20);  -- 允许 NULL
  第一步部署：新代码写 phone（如有），旧代码不写（phone 为 NULL）

  第二步迁移（等所有 Pod 都更新到新代码后）：
    -- 回填现有空值
    UPDATE users SET phone = '' WHERE phone IS NULL;
    -- 加非空约束
    ALTER TABLE users ALTER COLUMN phone SET NOT NULL;

  第三步（可选）：清理旧代码的兼容性逻辑
```

## 健康检查实现

### Liveness vs Readiness 的区别

这是 K8s 新手最容易混淆的概念：

| 探测类型  | 作用                                                 | 失败后果            |
| --------- | ---------------------------------------------------- | ------------------- |
| Liveness  | 应用是否还活着（是否需要重启）                       | K8s 重启 Pod        |
| Readiness | 应用是否准备好接收流量（数据库连接是否正常）         | 从 Service 摘除 Pod |
| Startup   | 应用是否完成初始化（给慢启动应用更长的启动时间容忍） | K8s 重启 Pod        |

**Liveness** 检查的是应用进程本身是否健康（不是死锁、不是无限循环，能正常响应 HTTP 请求）。Liveness 探测应该非常轻量，不依赖外部服务（即使数据库断了，Liveness 也应该返回 200）。

**Readiness** 检查的是应用是否能正常处理业务请求。只有数据库、Redis 连接都正常，才应该返回 200。如果 Readiness 失败，Pod 停止接收新流量，但不会被重启（等外部服务恢复后会自动恢复就绪）。

### NestJS 健康检查实现

```bash
pnpm add @nestjs/terminus
```

```typescript
// src/health/health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { DrizzleHealthIndicator } from './drizzle.health';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly drizzleHealth: DrizzleHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly memory: MemoryHealthIndicator
  ) {}

  // Liveness 探测：只检查应用进程本身是否存活
  @Get('liveness')
  @HealthCheck()
  liveness() {
    return this.health.check([
      // 只检查内存（进程层面），不检查外部依赖
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024), // 堆内存不超过 512MB
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024), // RSS 不超过 1GB
    ]);
  }

  // Readiness 探测：检查是否能处理业务流量
  @Get('readiness')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.drizzleHealth.isHealthy('database'), // 数据库连接正常
      () => this.redisHealth.isHealthy('redis'), // Redis 连接正常
    ]);
  }
}
```

```typescript
// src/health/drizzle.health.ts
import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { DrizzleService } from '../drizzle/drizzle.service';
import { sql } from 'drizzle-orm';

@Injectable()
export class DrizzleHealthIndicator extends HealthIndicator {
  constructor(private readonly drizzle: DrizzleService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // 执行轻量级查询（不访问业务表）
      await this.drizzle.db.execute(sql`SELECT 1`);
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Database health check failed',
        this.getStatus(key, false, { error: String(err) })
      );
    }
  }
}
```

```typescript
// src/health/redis.health.ts
import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const result = await this.redis.client.ping();
      if (result !== 'PONG') throw new Error('Unexpected ping response');
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, { error: String(err) })
      );
    }
  }
}
```

健康检查的返回格式示例：

```json
// GET /health/readiness → 200 OK（一切正常）
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  }
}

// GET /health/readiness → 503 Service Unavailable（数据库异常）
{
  "status": "error",
  "info": { "redis": { "status": "up" } },
  "error": {
    "database": {
      "status": "down",
      "error": "Connection timeout"
    }
  }
}
```

## 监控与告警

### 关键指标（Metrics）选取

认证服务的监控指标可以分为三类：

**黄金信号（Golden Signals）**：

| 指标类别 | 具体指标                             | 告警阈值示例                |
| -------- | ------------------------------------ | --------------------------- |
| 延迟     | HTTP 请求 P50/P95/P99 延迟           | P99 > 2000ms 持续 5 分钟    |
| 流量     | 每秒请求数（RPS）                    | RPS 突增 3 倍（可能是攻击） |
| 错误率   | 4xx/5xx 响应比例                     | 5xx 错误率 > 1%             |
| 饱和度   | CPU 使用率、内存使用率、Redis 连接数 | CPU > 80% 持续 10 分钟      |

**业务指标**：

| 指标             | 告警阈值               | 含义                                 |
| ---------------- | ---------------------- | ------------------------------------ |
| 登录失败率       | > 30%（正常不超过 5%） | 可能在暴力破解或枚举账号             |
| Token 刷新失败率 | > 5%                   | Refresh Token 大量失效（可能被吊销） |
| 数据库查询延迟   | P95 > 500ms            | 数据库可能有性能问题                 |
| Redis 命令延迟   | P95 > 10ms             | Redis 负载过高或网络问题             |

### Prometheus + NestJS 集成

```bash
pnpm add @willsoto/nestjs-prometheus prom-client
```

```typescript
// src/metrics/metrics.module.ts
import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
})
export class MetricsModule {}
```

```typescript
// src/metrics/auth-metrics.service.ts
import { Injectable } from '@nestjs/common';
import {
  InjectMetric,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';

// 在 Module providers 中注册
export const authMetricsProviders = [
  makeCounterProvider({
    name: 'auth_login_total',
    help: 'Total number of login attempts',
    labelNames: ['outcome', 'method'], // outcome: success/failure, method: password/oauth/magic_link
  }),
  makeHistogramProvider({
    name: 'auth_token_issue_duration_seconds',
    help: 'Duration of token issuance in seconds',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  }),
];

@Injectable()
export class AuthMetricsService {
  constructor(
    @InjectMetric('auth_login_total') private readonly loginCounter: Counter,
    @InjectMetric('auth_token_issue_duration_seconds')
    private readonly tokenDuration: Histogram
  ) {}

  recordLogin(outcome: 'success' | 'failure', method: string) {
    this.loginCounter.inc({ outcome, method });
  }

  recordTokenIssuance(durationSeconds: number) {
    this.tokenDuration.observe(durationSeconds);
  }
}
```

### Grafana 仪表盘关键面板

不需要从头设计 Grafana 仪表盘，可以使用 Grafana Dashboard ID 14058（NestJS 官方模板）作为基础，再添加认证专属面板。以下是几个关键 PromQL 查询：

```plaintext
# 过去 5 分钟的登录成功率
sum(rate(auth_login_total{outcome="success"}[5m]))
/
sum(rate(auth_login_total[5m]))

# 登录失败率热力图（按时间分布）
sum by(le) (rate(auth_login_total{outcome="failure"}[1m]))

# Token 颁发 P99 延迟
histogram_quantile(0.99, sum(rate(auth_token_issue_duration_seconds_bucket[5m])) by (le))

# HTTP 请求 P95 延迟（按接口分组）
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, handler))

# Redis 连接池使用率
redis_connected_clients / redis_maxclients * 100
```

### 告警规则（Prometheus Alert Rules）

```yaml
# prometheus/alert-rules.yaml
groups:
  - name: auth-service
    rules:
      - alert: HighLoginFailureRate
        expr: |
          sum(rate(auth_login_total{outcome="failure"}[5m]))
          /
          sum(rate(auth_login_total[5m])) > 0.3
        for: 2m
        labels:
          severity: high
        annotations:
          summary: 'High login failure rate detected'
          description: 'Login failure rate is {{ humanizePercentage $value }} over the last 5 minutes'

      - alert: AuthServiceDown
        expr: up{job="auth-service"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Auth service is down'

      - alert: HighP99Latency
        expr: |
          histogram_quantile(0.99,
            sum(rate(http_request_duration_seconds_bucket{job="auth-service"}[5m]))
            by (le)
          ) > 2
        for: 5m
        labels:
          severity: high
        annotations:
          summary: 'Auth service P99 latency is high'
          description: 'P99 latency is {{ $value }}s'

      - alert: DatabaseConnectionFailed
        expr: |
          auth_service_health{component="database"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'Auth service cannot connect to database'
```

## 数据库运维

### 生产数据库的迁移策略

使用 Drizzle ORM 的迁移命令：

```bash
# 生成迁移文件（基于 Schema 变更）
pnpm drizzle-kit generate

# 查看待执行的迁移
pnpm drizzle-kit status

# 执行迁移（在部署前的 CI 步骤中执行）
pnpm drizzle-kit migrate
```

在 `package.json` 中定义脚本：

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:status": "drizzle-kit status",
    "db:studio": "drizzle-kit studio"
  }
}
```

**迁移失败的回滚策略**：Drizzle 的迁移是顺序执行的，默认没有自动回滚。生产环境的最佳实践是：

1. 每次迁移前对数据库做快照（PostgreSQL 的 `pg_dump`）
2. 迁移失败时从快照恢复（对小数据量可行）
3. 更好的方式：设计向前兼容的迁移，使得回滚只需回退应用代码，而不需要回滚数据库

### 备份策略

认证服务的数据库包含用户账号、密码哈希、Token、会话等敏感数据，备份策略至关重要：

```bash
# 生产数据库备份脚本（每日凌晨 2 点执行）
#!/bin/bash
# backup.sh

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="auth_db_backup_${TIMESTAMP}.sql.gz"
S3_BUCKET="your-backup-bucket"

# 使用 PostgreSQL 的并行备份（更快）
pg_dump \
  --no-owner \
  --no-acl \
  --format=custom \
  --compress=9 \
  "$DATABASE_URL" \
  | gzip > "/tmp/${BACKUP_FILE}"

# 加密后上传到对象存储（使用 AWS KMS 或自管理密钥）
aws s3 cp "/tmp/${BACKUP_FILE}" "s3://${S3_BUCKET}/daily/${BACKUP_FILE}" \
  --sse aws:kms \
  --sse-kms-key-id "your-kms-key-id"

# 清理本地临时文件
rm "/tmp/${BACKUP_FILE}"

# 清理 30 天前的备份
aws s3 ls "s3://${S3_BUCKET}/daily/" \
  | awk '{print $4}' \
  | grep "$(date -d '30 days ago' +%Y%m%d)" \
  | xargs -I{} aws s3 rm "s3://${S3_BUCKET}/daily/{}"

echo "Backup completed: ${BACKUP_FILE}"
```

**备份恢复测试**：备份如果从未被测试恢复过，等于没有备份。应该每月至少做一次恢复演练，确认备份是可用的。

## 故障排查指南

### 常见故障与排查步骤

**故障一：Pod 反复重启（CrashLoopBackOff）**

```bash
# 第一步：查看 Pod 状态
kubectl get pods -n auth

# 第二步：查看最近的退出原因
kubectl describe pod <pod-name> -n auth

# 第三步：查看容器日志（包括已退出的上一个容器）
kubectl logs <pod-name> -n auth --previous

# 第四步：查看资源使用（是否 OOM 被 Kill）
kubectl top pods -n auth
```

常见原因：

- **OOMKilled**：内存超过 `resources.limits.memory`，调大内存 limit 或排查内存泄露
- **环境变量缺失**：`DATABASE_URL` 等必要变量未配置，检查 Secret/ConfigMap
- **数据库连接失败**：检查 Readiness 探测是否能连接数据库，检查网络策略（NetworkPolicy）

**故障二：登录接口突然变慢**

```bash
# 查看接口 P95 延迟是哪个环节慢
# 1. 检查数据库查询延迟
kubectl exec -it <postgres-pod> -n auth -- psql -U auth_user -c "
  SELECT query, mean_exec_time, calls
  FROM pg_stat_statements
  ORDER BY mean_exec_time DESC
  LIMIT 10;
"

# 2. 检查 Redis 延迟
kubectl exec -it <redis-pod> -n auth -- redis-cli --latency -i 1 -c 100

# 3. 检查 CPU/内存是否接近 limit
kubectl top pods -n auth
```

**故障三：Token 验证大量失败**

常见原因：JWT_ACCESS_SECRET 配置不同步（多个 Pod 使用了不同的 Secret）。

```bash
# 确认所有 Pod 使用的同一份 Secret
kubectl get secret auth-service-secrets -n auth -o yaml | grep JWT_ACCESS_SECRET

# 查看 Deployment 是否引用了正确的 Secret
kubectl describe deployment auth-service -n auth | grep -A 5 secretRef
```

**故障四：数据库连接池耗尽**

表现：请求排队，响应时间越来越长，最终超时。

```bash
# 检查当前连接数
kubectl exec -it <postgres-pod> -n auth -- psql -U auth_user -c "
  SELECT count(*), state
  FROM pg_stat_activity
  WHERE datname = 'auth_db'
  GROUP BY state;
"

# 查看是否有长时间运行的查询（可能在持锁）
kubectl exec -it <postgres-pod> -n auth -- psql -U auth_user -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
  FROM pg_stat_activity
  WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
    AND datname = 'auth_db';
"
```

解决方案：增加连接池大小（调整 Drizzle Pool 配置）或减少 Pod 的连接数（引入 PgBouncer），或排查长时间持锁的查询。

### 应急响应流程

当安全事件发生时（如发现账号被大规模入侵）：

```mermaid
graph TD
    Alert["收到告警"] --> Triage["初步判断\n（是否影响业务？）"]
    Triage -->|"影响广泛"| Escalate["升级\n（通知安全团队 + 管理层）"]
    Triage -->|"范围有限"| Contain["遏制\n（封禁涉事 IP / 临时禁用相关功能）"]
    Escalate --> Contain
    Contain --> Investigate["调查\n（审计日志分析 + Metrics 查看）"]
    Investigate --> RootCause["定位根因\n（漏洞 / 配置错误 / 内部人员）"]
    RootCause --> Remediate["修复\n（打补丁 / 轮换密钥 / 强制所有用户重置密码）"]
    Remediate --> Postmortem["事后复盘\n（记录时间线、根因、改进措施）"]
```

**紧急操作手册（Runbook）**：将上述流程和常用命令写成文档，放在团队共享文件夹中。安全事件发生时往往人员紧张、时间压力大，有现成 Runbook 可以大幅缩短响应时间。

## 常见问题与解决方案

### 镜像体积过大

**问题**：构建出的 Docker 镜像超过 1GB，推送和拉取都很慢。

**排查**：

```bash
# 分析每个镜像层的大小
docker history your-image:tag
# 或使用更详细的工具
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock wagoodman/dive your-image:tag
```

**常见原因与解决方案**：

- `node_modules` 中包含了开发依赖——确认多阶段构建的 `--prod` 参数
- `.git` 目录被复制进镜像——检查 `.dockerignore`
- 使用了 `node:22`（完整版）而非 `node:22-alpine`——Alpine 版本少 500MB+
- 中间层残留了缓存文件——在同一 `RUN` 指令中清理临时文件

```dockerfile
# 在同一 RUN 指令中安装和清理，避免缓存层残留
RUN apk add --no-cache --virtual .build-deps \
    python3 make g++ \
  && pnpm install --frozen-lockfile --prod \
  && apk del .build-deps
```

### 多副本下的 Session 不一致

**问题**：用户登录后，某些请求返回 401（未认证），刷新后又正常了。

**原因**：默认情况下 NestJS 的 Session（如果使用了 Session 认证）存储在内存中，每个 Pod 有自己的内存，同一用户的请求可能被路由到不同 Pod，读取不到 Session。

**解决方案**：确认 Redis Session Store 已正确配置（在模块二已实现），所有 Pod 共享同一个 Redis 实例。

JWT 认证不存在这个问题（无状态）。

### 优雅关机（Graceful Shutdown）

当 K8s 滚动更新时，旧 Pod 会收到 `SIGTERM` 信号。如果应用没有实现优雅关机，正在处理中的请求会被强行中断，用户收到错误。

```typescript
// src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 启用关机钩子
  app.enableShutdownHooks();

  await app.listen(3000);
}

// 在 AppModule 中实现 OnModuleDestroy 来清理资源
@Module({...})
export class AppModule implements OnModuleDestroy {
  async onModuleDestroy() {
    // 关闭数据库连接池（等待进行中的查询完成）
    await drizzlePool.end();
    // 关闭 Redis 连接
    await redisClient.quit();
  }
}
```

配合 K8s 的 `terminationGracePeriodSeconds: 30`，K8s 会在发送 `SIGTERM` 后等待最多 30 秒，让应用完成正在处理的请求再强行终止。

## 本篇小结

本篇覆盖了将认证服务从本地开发到生产环境交付的完整路径。

**容器化**：多阶段 Dockerfile 将生产镜像精简到最小——开发依赖不进生产，非 root 用户运行，`.dockerignore` 排除无关文件。最终镜像仅包含运行时必需的内容。

**K8s 部署的三个关键配置**：

- Secret 存放敏感配置（生产环境配合 Sealed Secrets 或 Vault）
- Deployment 的 `resources.limits` 防止单 Pod 耗尽节点资源
- 三种健康探测（Liveness / Readiness / Startup）精确控制 Pod 生命周期

**CI/CD**：GitHub Actions 工作流串联了代码检查、测试、镜像构建、漏洞扫描、数据库迁移和 K8s 滚动更新，整个过程全自动化。每次推送到 `main` 分支即触发完整流水线，部署步骤需要人工审批（Environment Protection）。

**监控告警**：Prometheus 采集指标，Grafana 可视化，Alert Rules 按黄金信号设置告警。认证服务关注登录成功率、Token 颁发延迟和登录失败率这三个核心业务指标。

**故障排查**：掌握 `kubectl describe`、`kubectl logs --previous`、`kubectl top` 这几个命令的组合使用，能解决 80% 的生产问题。提前编写 Runbook，安全事件发生时快速响应。

至此，整个认证教程系列全部完成。你已经构建了一个覆盖从理论到生产的完整认证系统，具备 Session 认证、JWT 认证、OIDC 授权服务器、第三方登录、API 网关、MFA、安全监控和生产部署的完整能力。
