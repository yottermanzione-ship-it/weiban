/** 仅浏览器自测的本机上游；不使用真实提供商密钥。 */
import { createServer } from 'node:http';
const upstream = createServer((request, response) => {
  if (request.url !== '/v1/models' || request.method !== 'GET') {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ object: 'list', data: [{ id: 'browser-test', object: 'model' }] }));
});
await new Promise<void>((resolve) => upstream.listen(3001, '127.0.0.1', resolve));
await import('./browser-app.js');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => upstream.close());
