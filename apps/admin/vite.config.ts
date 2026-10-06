import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const proxy = { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } };
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
