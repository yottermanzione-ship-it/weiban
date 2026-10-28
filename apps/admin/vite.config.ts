import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Ant Design 5 用 CSS-in-JS 注入 <style>，并大量使用 style 属性，所以样式必须允许 inline；
// 脚本仍然只允许本站文件（不允许 inline script / eval）。
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const proxy = {
  '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
  // V3：页面顶部比对服务器契约版本（GET /health）
  '/health': { target: 'http://127.0.0.1:3000', changeOrigin: false },
};
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'weiban-admin-csp',
      apply: 'build',
      transformIndexHtml() {
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  ],
  server: { port: 5174, proxy },
  // pnpm 的虚拟 store 会让依赖各自解析到自己的 react 副本，必须去重，
  // 否则 Ant Design / ProComponents 与页面用到两份 React，hooks 直接报错。
  resolve: { dedupe: ['react', 'react-dom', 'react/jsx-runtime'] },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react-router-dom',
      'antd',
      '@ant-design/pro-components',
    ],
  },
  preview: {
    port: 5174,
    proxy,
    headers: {
      'Content-Security-Policy': csp + "; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
});
