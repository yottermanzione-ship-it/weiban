import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
/**
 * U8 启动页：index.html 里的绿色启动层要在第一帧就画出来。
 * - 启动层样式（src/boot/boot.css，约 2KB）单独成一个带哈希的文件，放在 <head> 最前面；
 *   不能交给 Vite 合进 260KB 的主样式表，否则要等主样式表下载完才有第一帧。
 * - 主样式表的 <link> 挪到启动层之后、#root 之前：浏览器先画启动层，主样式表到了再解析后面的内容
 *   （模块脚本本来就在解析完之后执行，React 渲染时主样式表已就绪）。
 * 开发模式不处理（Vite 开发服务器直接给 /src/boot/boot.css）。
 */
const bootCssSource = readFileSync(new URL('./src/boot/boot.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{}:;,>])\s*/g, '$1')
  .trim();
const bootCssFile = `assets/boot-${createHash('sha256').update(bootCssSource).digest('hex').slice(0, 10)}.css`;
/**
 * 旧版素材的预缓存：icons/、tab/ 走下面的 globPatterns（约 330KB）；brand/ 只要启动页 logo（31KB），
 * 单独列在这里；字体（4.8MB）与提示音不进。
 */
const precacheOldUi = ['assets/old-ui/brand/icon.png'];
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
    {
      name: 'weiban-boot-css-strip',
      apply: 'build',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace(/[ \t]*<link[^>]*data-boot-css[^>]*>\r?\n?/, ''),
      },
    },
    {
      name: 'weiban-boot-css',
      apply: 'build',
      buildStart() {
        this.emitFile({ type: 'asset', fileName: bootCssFile, source: bootCssSource });
      },
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          const main = /[ \t]*<link rel="stylesheet"[^>]*href="\/assets\/index-[^"]+\.css"[^>]*>\r?\n?/;
          const link = html.match(main)?.[0];
          let out = link ? html.replace(link, '') : html;
          if (link)
            out = out.replace('<div id="root"></div>', `${link.trim()}\n    <div id="root"></div>`);
          return out.replace(
            '<meta charset="UTF-8" />',
            `<meta charset="UTF-8" />\n    <link rel="stylesheet" href="/${bootCssFile}" />`,
          );
        },
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
        // U8：安卓从桌面图标打开时系统先画的启动画面也是品牌绿，与网页启动层接上。
        background_color: '#07c160',
        theme_color: '#07c160',
        icons: [
          { src: '/Icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/Icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/Icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/Icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // 旧版素材的字体子集（4.8MB）与提示音不进预缓存，按需加载（HTTP 长缓存）。
        // U8：启动页 logo、图标、标签栏图进预缓存：离线也能打开启动页，切页时图标不再现取。
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: [
          'assets/old-ui/fonts/**',
          'assets/old-ui/audio/**',
          'assets/old-ui/brand/**',
        ],
        additionalManifestEntries: precacheOldUi.map((url) => ({
          url: `/${url}`,
          revision: createHash('sha256')
            .update(readFileSync(new URL(`./public/${url}`, import.meta.url)))
            .digest('hex')
            .slice(0, 16),
        })),
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
