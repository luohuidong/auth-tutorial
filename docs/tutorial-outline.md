# 认证系列教程大纲

## 概览

1. [教程整体规划](./tutorial-overview.md)
   - 完成度：✅
   - 内容关键字：教程规划, 整体架构, 学习路径, OIDC, 集中式认证
   - 内容摘要：本篇是整个系列的导航图。我们将构建一套集中式认证服务，涵盖邮箱密码登录、Google/GitHub/微信第三方登录、Magic Link 无密码登录、SSO 单点登录、SLO 单点登出以及 MFA 多因素认证；同时配套一个 API 网关（负责 JWT 验证与权限检查）和一个前端客户端示例。文章通过整体架构图展示浏览器、认证服务、API 网关、业务服务、第三方 IdP 及 PostgreSQL/Redis 存储之间的关系，然后用模块依赖图说明 8 个模块的递进学习顺序：认证基础 → Session 认证 → JWT 认证 → OIDC 服务器 → 第三方登录 / API 网关 → 客户端接入 → 高级安全与部署。最后用思维导图梳理 SSO 体系的核心概念，帮助读者在开始任何一章之前都能清楚自己所处的位置。

## 模块一：认证基础

1. [认证 vs 授权](./auth-vs-authz.md)
   - 完成度：✅
   - 内容关键字：认证, 授权, RBAC, 认证因子, 401与403
   - 内容摘要：本篇用机场安检的故事区分认证（"你是谁？"）与授权（"你能做什么？"）。认证部分讲解三类认证因子：知识因子（密码、PIN）、持有因子（手机、硬件密钥）、生物因子（指纹、人脸），并介绍 MFA 的价值。授权部分对比 RBAC（角色 → 权限）、ABAC（属性策略）、ACL（资源 → 主体列表）三种模型，并展示各自适用场景。文章还梳理了两者在时序上的关系（先认证后授权）、在架构中的位置，以及四个常见误区：把认证当授权、在认证阶段做授权决策、混淆 401（未认证）与 403（无权限）的 HTTP 状态码、认为"认证服务 = 用户服务"。最后提供两道动手练习加深理解。
2. [SSO 与集中式认证服务](./sso-architecture.md)
   - 完成度：✅
   - 内容关键字：SSO, IdP, SP, SSO Session, OIDC协议
   - 内容摘要：本篇以大学一卡通为类比，讲解单点登录的本质：学生处（IdP）统一发卡，图书馆/食堂（SP）只需信任一卡通而无需各自维护账号体系。文章先分析多系统分散认证的痛点（多套密码、数据孤岛、运维成本高），再完整讲解 SSO 的核心工作原理——SSO Session 存放在 IdP 侧，各业务应用各自维护本地 Session，"免密访问"的本质是浏览器带着 SSO Cookie 到达 IdP，IdP 检测到有效 Session 后直接颁发授权码。随后对比 SAML（企业级）、CAS（高校常见）、OIDC（互联网主流）三种协议，说明本教程选择 OIDC 的原因。最后划定认证服务的职责边界：只回答"你是谁"，不参与"你能做什么"。
3. [Session 与 JWT：它们在 SSO 中各司什么职](./sso-session-vs-jwt.md)
   - 完成度：✅
   - 内容关键字：Session vs JWT分工, SSO架构图, 可撤销性, 无状态验证, 模块学习指引
   - 内容摘要：本篇解决"学完 Session 和 JWT 技术，却不知道它们在 SSO 架构中用在哪里"的困惑。首先通过时序图标注 SSO 全链路中 Session 和 JWT 的应用边界：IdP 内部用 Session（可即时撤销用户身份），网关与业务服务之间用 JWT（无状态验签，水平扩展），SP 本地 Session 与 IdP SSO Session 两层独立共存。核心区别部分用「服务器存状态 vs 客户端带状态」一句话点明本质，并分析为何 IdP 必须用 Session（修改密码/封禁账号需要立即生效），为何网关到 SP 用 JWT 更合适（无需查库、性能好、无单点故障）。技术选型一览表覆盖 IdP 内部、SP 本地、网关验证、微服务调用、第三方集成五种场景的推荐方案。最后通过模块学习指引，帮助读者带着"这技术用在哪里"的问题去学习模块二（Session）和模块三（JWT），并在模块四 OIDC 服务器中理解两者的协作关系。
4. [密码安全基础](./password-security.md)
   - 完成度：✅
   - 内容关键字：密码哈希, 加盐, Bcrypt, Argon2, 密码泄露检测
   - 内容摘要：本篇从真实数据泄露案例（Facebook 明文、LinkedIn MD5、Adobe ECB 加密）出发，用"数字保险柜"类比说明为什么密码必须哈希而非加密或明文存储。哈希函数部分讲解单向性、雪崩效应，并解释为何 SHA-256 等通用哈希不适合密码（RTX 4090 可达 180 亿次/秒暴力破解）。随后深入彩虹表攻击与加盐防御机制，再讲 Bcrypt（成本因子选择、Blowfish 核心思想、局限性）和 Argon2（三种变体 d/i/id 的适用场景、内存/迭代/并行度三参数、OWASP 2024 推荐配置）。最后介绍线上系统的密码哈希算法不停机升级方案，以及通过 k-Anonymity 模型安全调用 Have I Been Pwned API 实现密码泄露检测。
4. [传输安全](./transport-security.md)
   - 完成度：✅
   - 内容关键字：HTTPS/TLS, CORS, CSRF, XSS, Cookie安全
   - 内容摘要：本篇以快递系统为类比，系统讲解 Web 传输安全的多个维度。HTTPS/TLS 部分详解 TLS 1.3 握手四个阶段（ClientHello、ServerHello+证书、ECDHE 密钥协商、Finished），解释对称加密、MAC 完整性校验和数字证书如何分别解决窃听、篡改、伪造三大威胁。CORS 部分区分简单请求与预检请求，说明为何 CORS 保护的是服务器而非浏览器。CSRF 部分分析攻击场景，对比 SameSite=Lax/Strict/None 的行为差异，并实现双重 Cookie 验证的 CSRF Token 方案。XSS 部分覆盖三种类型的防御（输入校验、输出编码、CSP），使用 Helmet 一键配置安全响应头，并介绍 CSP 的 report-uri 调试策略。

## 模块二：Session 认证基础

1. [用户模型设计](./user-model.md)
   - 完成度：✅
   - 内容关键字：Drizzle ORM, 用户Schema, 密码字段安全, 软删除, 字段分层
   - 内容摘要：本篇围绕"一张表背后的工程决策"展开，回答生产级用户表设计中常被忽视的问题。首先介绍选择 Drizzle ORM（类型安全 Schema、SQL 优先、无运行时魔法）和 PostgreSQL 18（强事务、UUID、jsonb）的理由。核心 Schema 设计涵盖：字段命名（passwordHash 而非 password，让意图自说明）、emailVerified 与 status（软删除替代物理删除）、roles、metadata（jsonb 存扩展属性）、createdAt/updatedAt/deletedAt 审计字段、合理的索引设计（email 唯一索引、status 部分索引）。重点讲解如何通过 TypeScript 类型系统防止 passwordHash 泄露到 API 响应——在 UserRepository 的查询方法上用 Omit 类型擦除敏感字段。最后划定认证服务用户表与业务服务用户表的职责边界。
2. [Session 核心机制](./session-mechanism.md)
   - 完成度：✅
   - 内容关键字：Session机制, Cookie安全属性, Redis存储, Passport Local, serializeUser
   - 内容摘要：本篇用时序图展示 Session 认证的完整流程：用户登录 → 写入 Redis Session → 下发 Set-Cookie → 后续请求携带 Cookie → 从 Redis 查询 Session → 返回用户信息。通过"银行保险柜"类比解释 Session（保险柜）、Session ID（编号）、Cookie（记有编号的小纸条）三者关系，并深入分析为何不能把用户信息直接存在 Cookie 里（安全性与可控性）。Cookie 安全属性部分逐一讲解 HttpOnly（防 XSS 窃取）、Secure（强制 HTTPS）、SameSite（防 CSRF）的防御目标，及 SameSite=Lax 与 Strict 的行为差异。Redis 存储部分覆盖 connect-redis 的配置细节。Passport.js 部分说明 Strategy（认证逻辑）、Guard（放行决策）的分工，以及 serializeUser（存什么进 Session）和 deserializeUser（如何从 Session 还原用户）的调用时机。
3. [注册登录 API](./register-login-api.md)
   - 完成度：✅
   - 内容关键字：Zod验证, 注册接口, 登录接口, 错误响应, ZodValidationPipe
   - 内容摘要：本篇实现三个核心接口：POST /auth/register（注册）、POST /auth/login（登录）、GET /auth/me（获取当前用户）。参数校验采用分层设计：Pipe 层用 Zod 4 做格式校验（实现 ZodValidationPipe 并全局注册），Service 层做业务校验（邮箱是否已注册），数据库层依靠唯一索引兜底。注册接口详细实现邮箱查重、密码哈希、数据库写入及注册后是否自动登录的权衡。登录接口讲解 Passport Local Guard 的执行顺序：Guard 先调用策略完成认证，再进入 Controller 方法。统一错误响应通过全局 ExceptionFilter 处理三类错误（Zod 验证错误、业务错误、系统异常），并展示最终的完整项目结构和 AppModule 配置。
4. [会话管理](./session-management.md)
   - 完成度：✅
   - 内容关键字：注销登录, 多设备管理, 滑动过期, 并发控制, Session安全
   - 内容摘要：本篇填补 Session 生命周期管理的最后一块拼图。注销部分讲清 req.logout()（清除 Passport 认证状态）与 req.session.destroy()（从 Redis 删除 Session）的区别及正确组合方式，并处理注销后 Cookie 的清除细节。过期策略对比绝对过期（固定生命周期）与滑动过期（活跃延续），并实现"记住我"功能（两种 TTL 的切换）。多设备管理设计 Redis 数据结构（user:{uid}:sessions Set 维护所有 Session ID），存储包含设备信息、IP、UA、最后活跃时间的 Session 元数据，实现会话列表接口和全设备注销。并发控制限制最大在线设备数，踢出最旧设备时处理 Race Condition。Session 安全部分讲解 Session Fixation Attack（登录时轮换 Session ID）及 Session Secret 的轮换策略。
5. [安全防护](./auth-security.md)
   - 完成度：✅
   - 内容关键字：登录频率限制, SQL注入防护, XSS防御, CSRF Token, 纵深防御
   - 内容摘要：本篇从攻击者视角出发，为 Session 认证系统构建纵深防御体系。登录频率限制从两个维度入手：按 IP 限制（防凭据填充/撞库攻击）和按账号限制（防针对性暴力破解），用 Redis 实现指数退避式递增锁定时长。SQL 注入防护讲解 Drizzle ORM 参数化查询为何默认安全，以及哪些写法仍有风险（动态表名/字段名、裸 SQL 字符串拼接）。XSS 防御覆盖 Helmet 安全响应头配置、CSP 策略语法与 report-only 调试模式、服务端输入净化。CSRF 防御重新审视 SameSite=Lax + CORS 在不同架构下是否足够，以及在 SPA 中实现双重 Cookie 验证模式的 CSRF Token 刷新策略。最后展示所有安全中间件的加载顺序和更新后的项目结构。

## 模块三：JWT 认证基础

1. [JWT 深度理论](./jwt-theory.md)
   - 完成度：✅
   - 内容关键字：JWT三段结构, 签名算法, alg:none攻击, JWT vs Session, RS256
   - 内容摘要：本篇从"为什么需要 JWT"出发，对比 Session 方案（服务器存状态，客户端凭号取数据）与 JWT 方案（服务器颁发数字身份证，客户端自带信息）。三段结构部分逐一拆解 Header（算法、类型、Base64URL 编码原理）、Payload（注册声明 sub/iss/aud/exp/iat/jti 的语义）、Signature（HMAC 与 RSA/EC 签名流程）。签名算法对比 HS256（对称，适合单服务）、RS256（非对称公私钥，适合微服务，验证者无需私钥）、ES256（椭圆曲线，签名更短）。JWT vs Session 从有无状态、可控性、水平扩展、存储成本等 8 个维度全面对比。安全误区部分讲解 alg:none 攻击（跳过签名验证）、算法混淆攻击（RS256 混淆为 HS256）及弱签名密钥风险，并给出正确防御方式。
2. [双令牌策略](./dual-token.md)
   - 完成度：✅
   - 内容关键字：Access Token, Refresh Token, 令牌轮换, 并发刷新竞态, 静默续期
   - 内容摘要：本篇解决 JWT 的根本矛盾：长有效期（体验好但泄露风险高）vs 短有效期（安全但频繁失效）。双令牌策略用两个职责分离的令牌解决这一矛盾：Access Token（15 分钟，存 JS 内存，用于 API 调用）和 Refresh Token（7~30 天，存 HttpOnly Cookie，用于换取新 Access Token）。Refresh Token 存储方案对比数据库（可撤销、支持多设备追踪，推荐）与 Redis（更快但功能受限）。完整刷新流程实现含数据访问层、Service 层、Controller 层代码。Refresh Token Rotation 讲解每次刷新时旧令牌失效的安全价值，及网络抖动下的幂等处理。并发刷新竞态问题提供两种解法：前端 Promise 锁（推荐）和服务端幂等键。页面刷新后内存中 Access Token 消失时的静默续期实现。
3. [JWT 黑名单](./jwt-blacklist.md)
   - 完成度：✅
   - 内容关键字：JWT撤销, Redis黑名单, jti, 布隆过滤器, Token Version
   - 内容摘要：本篇解决 JWT 无法主动撤销的问题。首先明确哪些场景真正需要即时撤销：修改密码、账号封禁、令牌泄露、用户注销、权限降级。Redis 黑名单设计：以 jti（JWT 唯一 ID）为 Key，以令牌剩余有效时间为 TTL（不用固定值），使得黑名单 Key 与令牌同步过期，避免无限增长。批量撤销方案使用 Token Version：在用户记录中维护版本号，每次需要批量撤销时递增版本，JWT 中携带版本号，验证时比对。布隆过滤器优化部分讲解位数组原理、假阳性率（不漏报但会误报）与参数调优，以及在 Redis Stack 中使用 RedisBloom 模块，将布隆过滤器作为黑名单查询的前置过滤层。最后讨论在 API Gateway vs 业务服务中放置黑名单检查的权衡。
4. [Passport JWT 策略](./passport-jwt.md)
   - 完成度：✅
   - 内容关键字：JwtStrategy, AuthGuard, 自定义装饰器, Token多来源提取, 模块整合
   - 内容摘要：本篇整合模块三所有内容，在 NestJS 中构建完整的 JWT 认证系统。Passport 工作原理部分用流程图说明 Strategy（认证逻辑：提取 Token → 验签 → 黑名单检查 → 返回用户信息）、Guard（放行决策）、Decorator（便捷获取用户信息）三层如何协作。Token 提取方式覆盖 Authorization Bearer Header、HttpOnly Cookie、以及自定义多来源提取器（同时支持多种方式的降级逻辑）。JwtAuthGuard 实现全局注册，通过 @Public() 装饰器标记例外路由。自定义装饰器包含 @CurrentUser()（从 req.user 中提取当前用户）和 @Roles()（角色声明）。错误处理统一不同失败场景的响应格式（401 未认证 vs 403 无权限）。最后展示完整的 JwtModule 配置和模块整合方式。

## 模块四：构建 OIDC 授权服务器

1. [认证服务整体设计](./oidc-server-design.md)
   - 完成度：✅
   - 内容关键字：OIDC架构, 数据库模型, 职责边界, RS256密钥管理, NestJS模块结构
   - 内容摘要：本篇是模块四的总体蓝图。架构图展示浏览器、OIDC 认证服务（PostgreSQL + Redis）、业务应用 A/B、API 网关的交互关系，并列出将要实现的全部 OIDC 端点。职责边界是本篇核心：认证服务只做"你是谁"（Authentication），业务服务自行处理"你能做什么"（Authorization）；两者之间通过 ID Token / Access Token 传递身份信息，认证服务不应存储业务数据。数据库模型设计涵盖 users 表（扩展字段）、oauth_clients 表（client_id、secret 哈希、redirect_uris 数组、allowed_scopes、client_type）、auth_codes 表（一次性、短 TTL，存 Redis）、oauth_tokens 表（access/refresh token 及元信息）、SSO Session 的 Redis 存储格式。NestJS 模块划分方案包含 UsersModule、ClientsModule、AuthModule、TokensModule、SsoModule、KeysModule，及 RS256 密钥对的生成与环境变量管理。
2. [客户端应用管理](./oidc-client-management.md)
   - 完成度：✅
   - 内容关键字：客户端注册, 机密客户端vs公开客户端, PKCE, Redirect URI精确匹配, Scope机制
   - 内容摘要：本篇实现 OIDC 客户端应用的注册与管理。首先解释"客户端"指接入认证服务的业务应用（而非用户浏览器），并类比银行开户说明注册机制的必要性（建立信任、约定 Scope、支持审计）。机密客户端（服务端应用，可安全持有 client_secret）与公开客户端（SPA/移动端，不能持有密钥，必须使用 PKCE）的本质差异贯穿全篇。Drizzle Schema 和 ClientsService CRUD 实现覆盖 client_id 生成、client_secret bcrypt 哈希存储。Redirect URI 白名单实行严格精确匹配（不允许通配符），防止开放重定向攻击。PKCE 机制详解 code_verifier（随机字符串）→ SHA256 → base64url → code_challenge 的转换链，以及在 Token 端点的 code_verifier 验证。最后展示实际注册示例：应用 A（BFF 机密客户端）和应用 B（SPA 公开客户端）的完整配置。
3. [授权端点与登录流程](./oidc-auth-endpoint.md)
   - 完成度：✅
   - 内容关键字：授权端点, SSO Session检测, 授权码生成, Consent授权确认, state防CSRF
   - 内容摘要：本篇实现 OIDC 最核心的 /oauth/authorize 端点。完整 Authorization Code Flow 时序图从用户访问受保护页面开始，涵盖有/无 SSO Session 两条路径。参数校验覆盖必须参数（response_type、client_id、redirect_uri）、推荐参数（scope、state、nonce）、PKCE 条件参数（code_challenge）和可选控制参数（prompt、max_age），并详细说明不同参数错误的处理策略（可重定向错误 vs 不可重定向错误需直接响应）。AuthorizeService 实现 SSO Session 检测（已登录则跳过登录步骤，直接颁发授权码）、授权码生成（存入 Redis，设 10 分钟 TTL，绑定 client_id、redirect_uri、scope 等参数）。登录页面和 /auth/login 接口在 SSO 流程中的配合。Consent 页面设计（何时需要、状态持久化）。state（绑定请求与回调，防 CSRF）和 nonce（嵌入 ID Token，防 ID Token 重放）的安全语义。
4. [Token 端点实现](./oidc-token-endpoint.md)
   - 完成度：✅
   - 内容关键字：Token端点, ID Token生成, 客户端身份认证, Refresh Token Rotation, Back-Channel通信
   - 内容摘要：本篇实现 /oauth/token 端点。Front-Channel（授权端点，经浏览器）与 Back-Channel（Token 端点，服务器直连）的设计差异是全篇出发点：Token 端点绝不重定向、参数通过 POST Body 而非 URL 传递、必须验证客户端身份。客户端认证两种方式：client_secret_basic（HTTP Basic Auth 头部，推荐）和 client_secret_post（请求体传参）；公开客户端使用 PKCE code_verifier 验证。ID Token Claims 结构详列必须包含（iss、sub、aud、exp、iat）、推荐包含（auth_time、nonce、at_hash）以及各 Scope 对应的 Claims。TokenService 完整实现：验证授权码（从 Redis 取出并删除，确保一次性）、生成 Access Token（RS256 签名）、生成 Refresh Token（存 DB）、生成 ID Token。Refresh Token Rotation：轮换模式下每次刷新旧令牌立即失效，检测令牌复用（reuse detection）的安全响应流程。
5. [OIDC 标准端点](./oidc-standard-endpoints.md)
   - 完成度：✅
   - 内容关键字：Discovery Document, JWKS端点, UserInfo端点, 密钥轮换, 标准化集成
   - 内容摘要：本篇实现让 OIDC 集成标准化的三个端点。Discovery Document（/.well-known/openid-configuration）包含所有端点 URL、支持的签名算法、Scope、Claims 等元信息，客户端只需知道 issuer URL 便可自动发现其余一切。JWKS 端点（/.well-known/jwks.json）以 JWK 格式公开 RS256 公钥，支持多密钥（通过 kid 区分），并实现密钥轮换时的无感知兼容：旧 kid 签发的 Token 在轮换期间仍可验证，直至自然过期。UserInfo 端点（/oauth/userinfo）要求有效 Access Token（Bearer），根据 Scope 过滤返回字段（openid 必须有 sub，profile 返回姓名头像，email 返回邮箱），并列出与 ID Token Claims 的取舍建议。另实现 Token 自省端点（Introspection）供 B2B 场景使用。最后配置各端点的 CORS 策略，防止跨域问题。
6. [SSO Session 与免登录](./oidc-sso-session.md)
   - 完成度：✅
   - 内容关键字：SSO Session, prompt参数, 静默认证, 多应用登录传播, iframePostMessage
   - 内容摘要：本篇深入 SSO Session 的设计与实现。两层 Session 并存的架构图说明 SSO Session（在认证服务 Redis 中，记录 userId、loginTime、loggedInClients 列表）与各应用本地 Session 各自的职责。完整 SsoService 实现 Session 的创建、读取、更新（记录新客户端登录、更新最后活跃时间）和销毁。prompt 参数的四种值分别对应不同场景：none（静默认证，无 SSO Session 则返回 error 而非跳转登录）、login（强制重新登录）、consent（强制显示授权确认页）、select_account（账号选择器）。max_age 参数限制 SSO Session 年龄，超过则要求重新认证。多应用登录传播机制：用户登录应用 A 后建立 SSO Session，访问应用 B 时浏览器自动携带 SSO Cookie，认证服务检测到有效 Session 后免密颁发授权码。静默认证用隐藏 iframe 加载 prompt=none 的授权 URL，通过 postMessage 将结果传回主页面。Session 安全加固包含登录时 Session ID 轮换和滑动 vs 固定过期策略对比。
7. [单点登出（SLO）](./oidc-slo.md)
   - 完成度：✅
   - 内容关键字：单点登出, RP-Initiated Logout, Front-Channel Logout, Back-Channel Logout, Logout Token
   - 内容摘要：本篇解决 SSO 中比登录复杂得多的登出问题。文章首先分析"登出难"的三个原因：已登录的应用数量未知、浏览器可能已关闭、应用服务器可能不可达。SLO 的三种场景：RP-Initiated Logout（最常见，业务应用发起）、认证服务主动登出（管理员强踢）、令牌过期触发。RP-Initiated Logout 实现 /oauth/logout 端点，处理 id_token_hint（按 sub 定位用户）和 post_logout_redirect_uri 参数。Front-Channel Logout：认证服务在登出页面渲染一组 iframe，每个 iframe 对应一个已登录客户端的登出 URL，浏览器加载这些 iframe 触发各应用清除本地 Session；不可靠之处在于浏览器关闭时无法触发。Back-Channel Logout：认证服务向各客户端的 back_channel_logout_uri 直接发送 POST 请求，携带 Logout Token（JWT 含特殊 event claim），更可靠但需要服务间网络可达。最后对比两种机制的适用场景和组合使用策略。

## 模块五：第三方登录集成

1. [OAuth2 协议详解](./oauth2-protocol.md)
   - 完成度：✅
   - 内容关键字：OAuth2协议, 授权码模式, PKCE, state防CSRF, 委托授权
   - 内容摘要：本篇从密码共享反模式（第三方应用持有完整账号密码）出发，说明 OAuth2 的本质是委托授权框架：用户在资源服务器（如 Google）上登录并选择授权范围，第三方应用获得有限权限的 Access Token，用户可随时撤销。四个核心角色：Resource Owner（用户）、Client（第三方应用）、Authorization Server（Google/GitHub）、Resource Server（API）。四种授权模式对比：Authorization Code（标准，推荐）、Implicit（已废弃）、Password（已废弃）、Client Credentials（机器间通信）。授权码模式深度解析五个步骤，重点说明前端通道（浏览器重定向）与后端通道（服务器间直连）的安全分工。state 参数的 CSRF 防护：生成时机（发起授权前）、存储位置（Session 或加密 Cookie）、验证时机（回调时比对）。PKCE 扩展：code_verifier → SHA256 → base64url → code_challenge 转换链，以及它为什么是公开客户端的唯一安全手段。
2. [OpenID Connect 详解](./oidc-protocol.md)
   - 完成度：✅
   - 内容关键字：OIDC协议, ID Token, nonce重放防护, Discovery Document, openid-client
   - 内容摘要：本篇讲清 OAuth2 与 OIDC 的边界：OAuth2 解决授权（Access Token 不能证明用户身份给当前应用），OIDC 在其上增加认证层（ID Token 专门携带用户身份信息）。ID Token 深度解析：它是一个 RS256 签名的 JWT，必须包含 iss（签发者）、sub（用户唯一 ID）、aud（受众，必须是 client_id）、exp、iat，还应包含 auth_time（实际认证时间）和 nonce。七步 ID Token 验证流程（签名、iss、aud、exp、iat、nonce、at_hash）缺一不可。nonce 防重放：客户端生成随机 nonce 存入 Session，发送到授权请求，认证服务嵌入 ID Token，客户端验证时比对——防止攻击者截获 ID Token 后重放给另一个应用。三种 OIDC 流程的适用场景：授权码流（推荐）、混合流（原生应用）、隐式流（已废弃）。OIDC 标准端点一览以及使用 openid-client 库集成 OIDC 的代码示例。
3. [第三方登录项目初始化](./oauth-project-setup.md)
   - 完成度：✅
   - 内容关键字：第三方登录架构, linked_accounts表, OAuthService, 账号关联, 事务原子性
   - 内容摘要：本篇解决架构决策：第三方登录应该集成到哪里？对比集成到 OIDC 授权服务器（推荐：账号体系统一、SSO 自然支持、linked_accounts 单一维护）与每个业务应用独立集成（不推荐：重复代码、无法 SSO、数据碎片化）。核心数据模型：linked_accounts 表设计（userId 外键、provider 枚举、providerUserId 字符串、providerEmail、accessToken/refreshToken 加密存储、metadata jsonb），并在 (provider, providerUserId) 上建唯一索引。Drizzle ORM Schema 和数据库迁移命令。配置管理模块：多 Provider 的环境变量组织方式、Zod 验证 Schema、OAuthConfigService。核心 OAuthService 实现通用的 findOrCreateUser 方法（查已有关联 → 同邮箱自动关联 → 创建新用户），其中用户创建与 linked_account 记录必须在同一事务中保证原子性。统一的 OAuth2 回调处理模式，适配所有 Provider。
4. [微信扫码登录集成](./wechat-login.md)
   - 完成度：✅
   - 内容关键字：微信OAuth2, openid与unionid, 二维码轮询, 非标准API处理, Redis状态管理
   - 内容摘要：本篇讲解与标准 OAuth2 差异显著的微信扫码登录。差异对比表涵盖术语（appid/appsecret）、Token 响应 Content-Type（text/plain 而非 json）、错误格式（errcode/errmsg 而非标准 error 字段）、用户信息获取方式（access_token + openid 作 URL 参数）等。openid vs unionid 的关键区别：openid 是用户在某个应用下的唯一 ID，同一用户在不同应用中 openid 不同；unionid 是跨应用的唯一 ID，但获取 unionid 有前提条件（用户关注了公众号，或在开放平台绑定了该应用）。完整实现：调用微信 API 生成二维码 URL → Redis 存储扫码状态（pending/scanned/confirmed/expired）→ 前端定时轮询状态接口 → 扫码确认后走标准 findOrCreateUser 流程 → 整合 SSO Session。处理微信 API 非标准响应和前端轮询的超时取消逻辑。
5. [Google 登录集成](./google-login.md)
   - 完成度：✅
   - 内容关键字：Google OAuth2, email_verified安全校验, Passport GoogleStrategy, hd企业限制, 首次登录UX
   - 内容摘要：本篇实现 Google OAuth2 登录。Console 配置部分：创建 Web 应用类型的 OAuth2 凭证（非桌面应用），配置 Redirect URI（redirect_uri_mismatch 是最常见错误），以及 OAuth Consent Screen 的必填字段和测试用户。GoogleStrategy 配置（clientID、clientSecret、callbackURL、scope）；verify 回调中 email_verified 的安全意义——若跳过验证，攻击者可注册未验证邮箱接管已有账号。GoogleController 实现两个路由：GET /auth/google（重定向到 Google）和 GET /auth/google/callback（处理授权码）。state 和 PKCE 处理（Passport 自动处理或自定义携带应用状态）。hd 参数限制特定 Google Workspace 域名登录（企业场景）。首次登录的三种用户体验设计：全新用户（自动创建账号）、同邮箱账号已存在（自动关联，仅限 email_verified=true）、需要额外信息（引导填写）。获取 Refresh Token 需要 access_type=offline 和 prompt=consent。
6. [GitHub 登录集成](./github-login.md)
   - 完成度：✅
   - 内容关键字：GitHub OAuth2, 私密邮箱处理, passport-github2, 数字用户ID, 特殊场景处理
   - 内容摘要：本篇实现 GitHub 登录。首先区分 GitHub OAuth App（代表用户操作，适合第三方登录）与 GitHub App（有自己身份，适合 CI/CD Bot）——第三方登录应选 OAuth App。GitHub 邮箱处理是本篇重点：GitHub 用户可将邮箱设为私密，/user 接口不返回邮箱，需单独调用 /user/emails 并筛选出 primary: true 且 verified: true 的邮箱；部分用户不公开任何邮箱，需设计无邮箱的账号创建策略。passport-github2 策略配置（scope 需包含 user:email 以获取私密邮箱）；validate() 回调中用 GitHub 数字型 id（转字符串）作为 providerUserId，而非 username（用户名可修改）。GitHubController 实现登录和回调路由。特殊场景：用户改了 GitHub 用户名、GitHub Page/组织账号登录。GitHub vs Google 的差异对比（GitHub 无 Refresh Token，Access Token 不主动过期但可被撤销）。
7. [Magic Link 邮箱登录](./magic-link.md)
   - 完成度：✅
   - 内容关键字：Magic Link, 一次性令牌, 密码学安全随机数, GETDEL原子操作, 防用户枚举
   - 内容摘要：本篇实现无密码的 Magic Link 登录。完整流程：用户提交邮箱 → 后端生成 32 字节密码学安全随机令牌（crypto.randomBytes，不能用 Math.random）→ 计算 SHA256 哈希 → Redis 存储哈希值（Key）映射邮箱（Value），TTL 15 分钟 → 发送含原始令牌的链接到邮箱 → 用户点击链接 → 后端计算收到令牌的哈希 → GETDEL 原子性取出并删除（防重放）→ 验证非空 → 找到或创建用户 → 建立 Session。令牌存哈希不存明文的原因：Redis 泄露时攻击者无法利用哈希值直接点击 Magic Link。Nodemailer + SMTP 的邮件发送服务实现。速率限制设计防止 SMTP 配额耗尽。安全要点：防用户枚举（无论邮箱是否存在均返回相同响应）、防点击劫持（Content-Security-Policy）。多设备行为：A 设备请求的链接在 B 设备点击完全有效。
8. [账号体系整合](./account-linking.md)
   - 完成度：✅
   - 内容关键字：账号绑定, 账号解绑, 账号合并, 邮箱验证信任, 冲突处理
   - 内容摘要：本篇梳理账号关联的完整场景和实现。三种典型场景：首次第三方登录且邮箱与已有账号匹配（仅限 email_verified=true 时自动关联）、用户在设置页主动绑定新登录方式（需已登录确认身份，防止他人替用户绑定）、第三方账号已被其他用户绑定（拒绝并提示，不允许静默解绑重绑）。绑定实现：在 OAuth2 state 中标记"这是绑定流程而非登录流程"，OAuth 回调时识别并创建 linked_account 记录（关联到当前登录用户而非创建新用户）。解绑前须确认用户还有其他登录方式，防止账号被锁定。账号合并（两个本地账号拥有同一邮箱时）：确定主账号，迁移次账号数据，要求二次确认（不可逆）。并发绑定竞态依靠数据库唯一约束兜底。"找回账号"功能帮助用户找到自己曾用过的登录方式。

## 模块六：API 网关

1. [API 网关设计](./api-gateway-design.md)
   - 完成度：✅
   - 内容关键字：API网关架构, JWT验证, 职责边界, 请求处理管道, 无状态网关
   - 内容摘要：本篇首先通过反例说明没有网关的问题：每个业务服务重复编写 JWT 验证、公钥缓存、RBAC 检查代码，任何逻辑变更都需要跨多个仓库同步。引入 API 网关后，所有流量的认证和粗粒度权限在统一入口处理。网关的职责边界：验证 Token（不颁发 Token）、粗粒度 RBAC（角色是否匹配）、限流、路由转发；细粒度授权（用户是否有权操作某条记录）留由业务服务自行处理。NestJS 请求处理管道详解：Middleware（路由匹配前，用于日志和 Token 提取）、Guard（访问控制，可中断请求）、Interceptor（响应转换和日志）。网关设计为无状态：所有决策由 Token 中的 Claims 驱动，不存储任何 Session。错误处理遵循 RFC 7807 Problem Details 格式，保证跨服务的错误响应一致性。最后规划 NestJS 网关的模块结构：AuthModule、PermissionModule、RateLimitModule、ProxyModule。
2. [JWT 验证中间件](./jwt-middleware.md)
   - 完成度：✅
   - 内容关键字：JWKS公钥缓存, 缓存击穿互斥锁, 熔断器, 缓存雪崩防护, 密钥轮换
   - 内容摘要：本篇实现网关场景下的 JWT 验证中间件，重点解决业务服务（静态公钥）无法满足的三个网关挑战。公钥缓存设计：内存 Map 按 kid 缓存公钥，随机 TTL 抖动（±10%）防止缓存雪崩（大量 key 同时过期引发并发请求）。缓存击穿（单个 kid 失效引发大量并发刷新）用 AsyncMutex 解决：只允许一个请求去拉取 JWKS，其余等待该 Promise 结果。熔断器模式保护网关免受认证服务故障影响：三态状态机（Closed 正常 → Open 全部快速失败 → Half-Open 探测恢复），可配置失败阈值、Open 持续时间、Half-Open 成功次数。完整 JWT 验证服务：从 Token Header 解析 kid → 从缓存或 JWKS 获取公钥 → jose 验签 → 返回 Payload。JwtAuthGuard 注册为全局 Guard。密钥轮换处理：认证服务新增 kid 时网关自动拉取，旧 kid 签发的 Token 仍在对应缓存项过期前有效。
3. [权限检查守卫](./permission-guard.md)
   - 完成度：✅
   - 内容关键字：RBAC, OAuth2 Scope, 自定义守卫链, 装饰器元数据, 细粒度授权边界
   - 内容摘要：本篇在 JWT 验证之上实现权限检查层。认证与授权边界再次厘清：JwtAuthGuard 完成"你是谁"，本篇的 RbacGuard 和 ScopeGuard 负责"你能做这件事吗"，业务服务负责"你能操作这条具体记录吗"。RBAC 实现：角色层级定义（guest/user/moderator/admin），@Roles() 装饰器通过 Reflect.metadata 将角色需求写入路由元数据，RbacGuard 用 Reflector 读取元数据并与 JWT Payload 中的 roles 比对，Reflector.getAllAndOverride 支持方法级配置覆盖类级配置。Scope 权限：命名约定为 resource:action（如 orders:write），@RequireScopes() 装饰器声明所需 Scope，ScopeGuard 从 JWT Payload 的 scope 字段验证。多 Guard 组合（AND 语义，二者都需满足），以及 @Public() 装饰器跳过所有检查。守卫执行顺序保证：JwtAuthGuard → RbacGuard → ScopeGuard，前者失败则后者不执行。
4. [高级网关功能](./advanced-gateway.md)
   - 完成度：✅
   - 内容关键字：限流算法, 令牌桶, 灰度发布, 多租户, Redis Lua脚本原子性
   - 内容摘要：本篇实现四类高级网关功能。限流：对比令牌桶算法（允许短期突发，桶满时储蓄，耗尽时拒绝）和滑动窗口算法（严格控制固定时间窗口内的请求数），用 Redis Lua 脚本保证分布式环境下的原子性（非 Lua 脚本会有竞态），按 IP/用户 ID/端点三种维度分别实施，返回 429 响应并附 Retry-After 头。熔断器：针对业务服务的熔断保护，防止某个后端服务故障拖垮整个网关。灰度发布（Canary Release）：三种流量分割策略——请求头标记（X-Version）、用户 ID 哈希取余（保证同一用户始终路由到同一版本，解决粘性问题）、百分比随机；通过 Cookie 存储版本号防止来回切换。多租户：从子域名、请求头或 JWT claims 识别租户，实现租户级别的限流配额和熔断独立配置，讨论数据隔离（独立数据库）与共享基础设施的边界选择。

## 模块七：客户端接入指南

1. [Web 应用接入（纯前端模式）](./web-client-spa.md)
   - 完成度：✅
   - 内容关键字：SPA接入, PKCE授权码流, Token存储安全, 静默认证iframe, 多标签页同步
   - 内容摘要：本篇讲解 SPA 作为 OIDC Relying Party 的完整接入方案。纯前端模式的根本约束：所有代码对用户可见，无法安全持有 client_secret，因此必须使用 PKCE。TypeScript 实现 PKCE：生成 96 字节随机 code_verifier → SHA256 → base64url → code_challenge，授权请求携带 challenge，Token 换取时携带 verifier。Token 存储三方案对比：内存（最安全，页面刷新后丢失）、localStorage（持久化，XSS 可窃取）、sessionStorage（Tab 隔离，XSS 可窃取）；推荐 Access Token 存内存，Refresh Token 通过认证服务的 HttpOnly Cookie 管理。自动刷新：主动刷新（在到期前 80% 时触发）+ 被动刷新（请求收到 401 时触发），用 Promise 互斥锁防止并发刷新。静默认证：创建隐藏 iframe 加载 prompt=none 授权 URL，通过 postMessage 传回授权码（注意现代浏览器第三方 Cookie 限制）。多标签页同步：BroadcastChannel 广播登录/登出事件。
2. [Web 应用接入（BFF 模式）](./web-client-bff.md)
   - 完成度：✅
   - 内容关键字：BFF模式, HttpOnly Cookie, Token代理, 服务端Session, CSRF防护
   - 内容摘要：本篇讲解 BFF（Backend For Frontend）模式的安全优势和实现细节。BFF 核心价值：将 Token 从浏览器移到服务端持有，XSS 无法再直接窃取 Token。架构图展示 SPA 只与 BFF 交互，BFF 持有并管理 Access Token/Refresh Token，以 Session Cookie 对前端标识身份。BFF 实现完整 OIDC 授权码流程（BFF 是机密客户端、持有 client_secret），将 Token 加密后存入 Redis Session，向 SPA 下发 HttpOnly+Secure+SameSite Session Cookie。Token 代理：SPA 发起 API 请求到 BFF，BFF 从 Session 取出 Access Token，添加 Authorization 头，代理转发到资源服务器。Token 透明刷新：BFF 在转发前检查 Access Token 剩余有效期，临期时自动刷新，对 SPA 完全透明。CSRF 防护（使用 Cookie 就必须防 CSRF）：BFF 配置 SameSite=Lax 并结合 CORS 白名单，必要时增加 CSRF Token。分布式 BFF 的 Session 一致性须用共享 Redis。

## 模块八：高级安全与部署

1. [多因素认证（MFA）](./mfa.md)
   - 完成度：✅
   - 内容关键字：TOTP原理, MFA注册流程, 两阶段登录, 恢复码, Replay Attack防护
   - 内容摘要：本篇实现 TOTP（基于时间的一次性密码）多因素认证。数学原理：TOTP = Truncate(HMAC-SHA1(Base32密钥, floor(Unix时间戳/30)))，每 30 秒一个新码，客户端与服务端只要时间同步即可独立生成相同结果，无需网络交互。时间偏差容忍机制允许前后各一个窗口，防止时钟漂移导致合法用户验证失败。Replay Attack 防护通过 Redis 记录已使用的 TOTP 码（Key 为用户 ID + 时间步长），同一码在同一窗口内只能使用一次。MFA 注册流程：生成 20 字节 Base32 密钥 → 构造 otpauth:// URI → 生成二维码 → 用户扫码绑定 Authenticator App → 输入首个 TOTP 码验证。两阶段登录：密码验证后颁发短期 pre-MFA Session（Redis 存储，3 分钟 TTL），TOTP 验证通过后升级为完整 Session。恢复码：生成 8 个 16 字符随机码、bcrypt 哈希存储、一次性使用，剩余数量不足时警告用户。备用 SMS OTP 的定位与局限性。
2. [审计与安全监控](./audit-monitoring.md)
   - 完成度：✅
   - 内容关键字：审计日志, 攻击检测, 异常登录告警, 合规要求, 异步写入
   - 内容摘要：本篇区分审计日志（给安全审计和合规用，追踪"谁在什么时候对什么资源做了什么"）与应用日志（给开发者调试用），并强调两者绝不可混用。审计日志 Schema 设计：eventId（全局唯一）、timestamp、eventType（auth.login.success/failure 等枚举）、actor（userId、IP、userAgent）、resource、outcome、reason，禁止记录密码、Token 明文和敏感 PII。异步写入（通过消息队列或 setImmediate）避免审计写入阻塞认证主流程。攻击检测覆盖四类：暴力破解（Redis 滑动窗口统计单账号登录失败次数）、账号枚举（检测对大量不存在账号的查询）、异常地理位置（IP 地理信息库 + 以往登录位置对比）、Session 劫持（登录后 User-Agent 突变）。告警通知集成邮件、Slack Webhook 和 PagerDuty，按安全等级分级触发。合规要求：GDPR 的数据最小化和删除权、SOC 2 的日志留存与完整性保证。
3. [生产部署](./production-deployment.md)
   - 完成度：✅
   - 内容关键字：Docker多阶段构建, Kubernetes部署, CI/CD, Prometheus监控, 健康检查
   - 内容摘要：本篇覆盖认证服务从容器化到生产环境的完整部署链路。核心原则：不可变基础设施（变更通过重新部署而非 SSH 修改）、配置外置（所有环境变量通过环境变量或配置中心注入）、最小权限（容器以非 root 用户运行）、可观测性（Metrics + Tracing + Logging）。多阶段 Dockerfile：deps 阶段（pnpm install 利用层缓存）、builder 阶段（TypeScript 编译、删除开发依赖）、production 阶段（Alpine 基础镜像、非 root 用户、声明健康检查）。Kubernetes 部署配置：Deployment（3 副本、滚动更新策略）、Service（ClusterIP）、ConfigMap（非敏感配置）、Secret（敏感配置，生产用 Sealed Secrets 或 Vault）、HPA（按 CPU/RPS 自动扩缩容）、Ingress（HTTPS 终止，cert-manager）。GitHub Actions CI/CD 流水线：Lint → Test → Docker Build & Push → kubectl apply。Prometheus + Grafana 监控关键指标（JWT 验证延迟、Token 颁发率、错误率）及告警规则。数据库迁移的零停机策略和备份恢复命令。健康检查：/health/live（存活探测）和 /health/ready（就绪探测，检查 DB + Redis 连接）。

## 模块九：综合练习

1. 综合练习
   - 完成度：⬜
   - 内容关键字：综合项目, 需求规格, 评分标准, 参考答案, 关键决策
   - 内容摘要：本篇为综合练习，尚未完成。计划内容包括：完整的项目需求说明、功能规格文档、技术选型与架构要求、各功能点的评分标准、参考实现方案，以及对关键设计决策的解析说明，帮助读者综合运用系列教程的所有知识点。
