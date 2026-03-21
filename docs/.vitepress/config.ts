import { defineConfig } from 'vitepress';
import { withMermaidConfig } from '@unify-js/vitepress-mermaid/config';

// https://vitepress.dev/reference/site-config
export default withMermaidConfig(
  defineConfig({
    title: 'Vitepress Mermaid Starter',
    description: 'A VitePress Site',
    themeConfig: {
      // https://vitepress.dev/reference/default-theme-config
      nav: [
        { text: 'Home', link: '/' },
        { text: 'Mermaid Examples', link: '/mermaid-examples' },
      ],

      sidebar: [
        {
          text: '模块一：认证基础',
          collapsed: false,
          items: [{ text: '认证 vs 授权', link: '/auth-vs-authz' }],
        },
      ],

      socialLinks: [
        { icon: 'github', link: 'https://github.com/vuejs/vitepress' },
      ],
    },
  })
);
