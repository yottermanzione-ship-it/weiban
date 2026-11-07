import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { SendMessageRequest } from '@weiban/contracts';

/** 本机测试入口直接中断实际连接；不依赖浏览器对 Service Worker 请求的拦截支持。 */
export async function releaseProxy(messageText: string) {
  let mode: 'up' | 'http' | 'down' | 'stalled' = 'up';
  let stateReads = 0;
  const sentIds: string[] = [];
  const sockets = new Set<Duplex>();
  const server = createServer((incoming, outgoing) => {
    if (incoming.url === '/api/v1/sync/state') stateReads++;
    if (
      incoming.method === 'POST' &&
      /^\/api\/v1\/conversations\/[^/]+\/messages$/.test(incoming.url ?? '')
    ) {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        try {
          const parsed = SendMessageRequest.safeParse(JSON.parse(Buffer.concat(chunks).toString()));
          if (
            parsed.success &&
            parsed.data.content.type === 'text' &&
            parsed.data.content.text === messageText
          )
            sentIds.push(parsed.data.clientMsgId);
        } catch {
          /* Only fixture message IDs are observed. */
        }
      });
    }
    if (mode === 'stalled' && incoming.url?.startsWith('/api/')) {
      incoming.resume();
      // 连接保持但没有响应：覆盖手机网络超时，而不只是立即返回503。
      return;
    }
    if (mode === 'down' && incoming.url?.startsWith('/api/')) {
      incoming.resume();
      outgoing.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      outgoing.end('controlled local release interruption');
      return;
    }
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: 5173,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on('aborted', () => upstream.destroy());
    outgoing.on('close', () => {
      if (!outgoing.writableEnded) upstream.destroy();
    });
    incoming.pipe(upstream);
  });
  server.on('upgrade', (incoming, socket, head) => {
    if (mode !== 'up') {
      socket.destroy();
      return;
    }
    const upstream = connect(5173, '127.0.0.1', () => {
      const headers = incoming.rawHeaders;
      let handshake = `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n`;
      for (let i = 0; i < headers.length; i += 2)
        handshake += `${headers[i]}: ${headers[i + 1]}\r\n`;
      upstream.write(handshake + '\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    sockets.add(socket);
    sockets.add(upstream);
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      socket.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local proxy address missing');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    get stateReads() {
      return stateReads;
    },
    sentIds,
    mode(value: typeof mode) {
      mode = value;
      if (mode !== 'up') for (const socket of sockets) socket.destroy();
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
