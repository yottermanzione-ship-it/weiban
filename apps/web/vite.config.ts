import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const proxy = { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false, ws: true } };
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'weiban-production-csp',
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
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: '微伴',
        short_name: '微伴',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        background_color: '#ededed',
        theme_color: '#0aa35a',
        icons: [
          { src: '/generated/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          {
            src: '/generated/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: { port: 5173, proxy },
  preview: {
    port: 5173,
    proxy,
    headers: {
      'Content-Security-Policy': csp + "; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
});
