import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
/**
 * 网页构建号（版本检查 / 更新说明用的 versionCode）：每次打包重新计算，单调递增。
 * 默认 = 2026-01-01 起的分钟数；部署脚本可用环境变量 WEB_BUILD_NUMBER 指定。
 */
const buildNumber =
  Number(process.env.WEB_BUILD_NUMBER) ||
  Math.max(1, Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60_000));
const webVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const proxy = { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false, ws: true } };
export default defineConfig({
  define: {
    __WEB_BUILD__: JSON.stringify(buildNumber),
    __WEB_VERSION__: JSON.stringify(webVersion),
  },
  plugins: [
    react(),
    {
      name: 'weiban-build-info',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify({ version: webVersion, versionCode: buildNumber }),
        });
        console.log(`[weiban] 网页版本 ${webVersion}，构建号 ${buildNumber}`);
      },
    },
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
