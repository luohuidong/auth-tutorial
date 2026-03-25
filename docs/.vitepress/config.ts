import { defineConfig } from 'vitepress';
import { withMermaidConfig } from '@unify-js/vitepress-mermaid/config';

// https://vitepress.dev/reference/site-config
export default withMermaidConfig(
  defineConfig({
    title: 'Auth Tutorial',
    themeConfig: {
      // https://vitepress.dev/reference/default-theme-config
      nav: [{ text: 'Home', link: '/' }],

      outline: {
        level: [2, 4],
      },

      sidebar: [
        {
          text: '模块一：认证基础',
          collapsed: false,
          items: [
            { text: '认证 vs 授权', link: '/auth-vs-authz' },
            { text: 'SSO 架构', link: '/sso-architecture' },
            { text: '密码安全基础', link: '/password-security' },
            { text: '传输安全', link: '/transport-security' },
          ],
        },
      ],

      socialLinks: [
        { icon: 'github', link: 'https://github.com/vuejs/vitepress' },
      ],
    },
  })
);
