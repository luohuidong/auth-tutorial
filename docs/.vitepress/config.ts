import { defineConfig } from 'vitepress';
import vitepressMermaidConfig from '@unify-js/vitepress-mermaid/config';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  extends: vitepressMermaidConfig,
  title: 'Auth Tutorial',
  base: '/auth-tutorial/',
  themeConfig: {
    outline: {
      level: [2, 3],
    },

    sidebar: [
      {
        text: '概览',
        collapsed: false,
        items: [
          { text: '教程整体规划', link: '/tutorial-overview' },
          { text: '教程大纲', link: '/tutorial-outline' },
        ],
      },
      {
        text: '模块一：认证基础',
        collapsed: false,
        items: [
          { text: '认证 vs 授权', link: '/auth-vs-authz' },
          { text: 'SSO 与集中式认证服务', link: '/sso-architecture' },
          { text: '密码安全基础', link: '/password-security' },
          { text: '传输安全', link: '/transport-security' },
        ],
      },
      {
        text: '模块二：Session 认证基础',
        collapsed: false,
        items: [
          { text: '用户模型设计', link: '/user-model' },
          { text: 'Session 核心机制', link: '/session-mechanism' },
          { text: '注册登录 API', link: '/register-login-api' },
          { text: '会话管理', link: '/session-management' },
          { text: '安全防护', link: '/auth-security' },
        ],
      },
      {
        text: '模块三：JWT 认证基础',
        collapsed: false,
        items: [
          { text: 'JWT 深度理论', link: '/jwt-theory' },
          { text: '双令牌策略', link: '/dual-token' },
          { text: 'JWT 黑名单', link: '/jwt-blacklist' },
          { text: 'Passport JWT 策略', link: '/passport-jwt' },
        ],
      },
      {
        text: '模块四：构建 OIDC 授权服务器',
        collapsed: false,
        items: [
          { text: '认证服务整体设计', link: '/oidc-server-design' },
          { text: '客户端应用管理', link: '/oidc-client-management' },
          { text: '授权端点与登录流程', link: '/oidc-auth-endpoint' },
          { text: 'Token 端点实现', link: '/oidc-token-endpoint' },
          { text: 'OIDC 标准端点', link: '/oidc-standard-endpoints' },
          { text: 'SSO Session 与免登录', link: '/oidc-sso-session' },
          { text: '单点登出（SLO）', link: '/oidc-slo' },
        ],
      },
      {
        text: '模块五：第三方登录集成',
        collapsed: false,
        items: [
          { text: 'OAuth2 协议详解', link: '/oauth2-protocol' },
          { text: 'OpenID Connect 详解', link: '/oidc-protocol' },
          { text: '第三方登录项目初始化', link: '/oauth-project-setup' },
          { text: '微信扫码登录集成', link: '/wechat-login' },
          { text: 'Google 登录集成', link: '/google-login' },
          { text: 'GitHub 登录集成', link: '/github-login' },
          { text: 'Magic Link 邮箱登录', link: '/magic-link' },
          { text: '账号体系整合', link: '/account-linking' },
        ],
      },
      {
        text: '模块六：API 网关',
        collapsed: false,
        items: [
          { text: 'API 网关设计', link: '/api-gateway-design' },
          { text: 'JWT 验证中间件', link: '/jwt-middleware' },
          { text: '权限检查守卫', link: '/permission-guard' },
          { text: '高级网关功能', link: '/advanced-gateway' },
        ],
      },
      {
        text: '模块七：客户端接入指南',
        collapsed: false,
        items: [
          { text: 'Web 应用接入（纯前端模式）', link: '/web-client-spa' },
          { text: 'Web 应用接入（BFF 模式）', link: '/web-client-bff' },
        ],
      },
      {
        text: '模块八：高级安全与部署',
        collapsed: false,
        items: [
          { text: '多因素认证（MFA）', link: '/mfa' },
          { text: '审计与安全监控', link: '/audit-monitoring' },
          { text: '生产部署', link: '/production-deployment' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/luohuidong/auth-tutorial' },
    ],
  },
});
