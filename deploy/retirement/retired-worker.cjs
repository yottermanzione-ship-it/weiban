'use strict';
// Replaces only the old Flutter /app/ worker; preserves all browser storage.
const retiredWorker = `self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  for (const client of await self.clients.matchAll({type:'window', includeUncontrolled:true})) {
    const url = new URL(client.url);
    if (url.origin === self.location.origin && (url.pathname === '/app' || url.pathname.startsWith('/app/')))
      await client.navigate('https://app.weiban.online/').catch(() => null);
  }
})()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(Response.redirect('https://app.weiban.online/', 302));
});
`;
module.exports = { retiredWorker };
