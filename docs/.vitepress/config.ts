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
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/luohuidong/auth-tutorial' },
    ],
  },
});
