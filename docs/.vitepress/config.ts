import { defineConfig } from 'vitepress';
import vitepressMermaidConfig from '@unify-js/vitepress-mermaid/config';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  extends: vitepressMermaidConfig,
  title: 'Auth Tutorial',
  base: '/auth-tutorial/',
  themeConfig: {
    outline: {
      level: [2, 6],
    },

    sidebar: [
      {
        text: '概览',
        collapsed: false,
        items: [
          { text: '教程概览', link: '/tutorial-overview' },
          { text: '教程大纲', link: '/tutorial-outline' },
        ],
      },
      {
        text: '模块一：直观认识',
        collapsed: false,
        items: [
          { text: '认证 vs 授权', link: '/auth-vs-authz' },
          { text: 'OIDC 授权码 Flow 完整演示', link: '/oidc-flow-demo' },
          { text: 'OIDC 核心概念', link: '/oidc-core-concepts' },
          { text: 'SSO 是什么', link: '/sso-what-is' },
        ],
      },
      {
        text: '模块二：OIDC 协议详解',
        collapsed: false,
        items: [
          { text: 'OAuth2 协议详解', link: '/oauth2-protocol' },
          { text: 'OIDC 协议详解', link: '/oidc-protocol' },
          { text: 'ID Token 深度解析与 JWT 基础', link: '/oidc-id-token' },
          { text: 'OIDC 标准端点', link: '/oidc-standard-endpoints' },
        ],
      },
      {
        text: '模块三：OIDC 服务器实现',
        collapsed: false,
        items: [
          { text: '认证服务整体设计', link: '/oidc-server-design' },
          { text: '客户端应用管理', link: '/oidc-client-management' },
          { text: '授权端点与登录流程', link: '/oidc-auth-endpoint' },
          { text: 'Token 端点实现', link: '/oidc-token-endpoint' },
          { text: 'SSO Session 与免登录', link: '/oidc-sso-session' },
          { text: '单点登出（SLO）', link: '/oidc-slo' },
        ],
      },
      {
        text: '模块四：客户端接入',
        collapsed: false,
        items: [
          { text: 'SPA PKCE 授权码流程', link: '/spa-pkce-flow' },
          { text: 'SPA 静默认证与多标签页同步', link: '/spa-silent-auth' },
          { text: 'Web 应用接入（BFF 模式）', link: '/web-client-bff' },
          { text: '前端集成实验', link: '/spa-integration-experiment' },
        ],
      },
      {
        text: '模块五：API 网关集成',
        collapsed: false,
        items: [
          { text: 'API 网关设计', link: '/api-gateway-design' },
          { text: 'JWT 验证中间件', link: '/jwt-middleware' },
          { text: '网关验证实验', link: '/gateway-verification-experiment' },
        ],
      },
      {
        text: '模块六：扩展内容',
        collapsed: false,
        items: [
          { text: '密码安全基础', link: '/password-security' },
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
