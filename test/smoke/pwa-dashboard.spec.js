import { expect, test } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';

// Exercise a real installed prior worker, not a mocked CacheStorage upgrade.
test('prior PWA worker upgrades the shell and caches every local vector asset', async ({ browser }) => {
  const previousWorker = await fs.readFile(new URL('../fixtures/sw-configured-defaults-13.js', import.meta.url), 'utf8');
  let upgraded = false;
  const proxy = http.createServer(async (request, response) => {
    try {
      if (request.url === '/sw.js' && !upgraded) {
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        response.end(previousWorker);
        return;
      }
      const upstream = await fetch(`http://127.0.0.1:3091${request.url}`);
      let body = Buffer.from(await upstream.arrayBuffer());
      if (!upgraded && ['/', '/app'].includes(request.url)) {
        body = Buffer.from(body.toString().replace(/^.*\/vendor\/maplibre.*\n/gm, ''));
      }
      const headers = Object.fromEntries(upstream.headers);
      delete headers['content-encoding'];
      delete headers['content-length'];
      headers['cache-control'] = 'no-store';
      response.writeHead(upstream.status, headers);
      response.end(body);
    } catch (error) {
      response.writeHead(500);
      response.end(error.message);
    }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/privacy`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    const oldCache = 'mesh-health-check-pwa-v1.4.0-configured-defaults-13';
    await expect.poll(() => page.evaluate(() => caches.keys())).toContain(oldCache);
    const oldShell = await page.evaluate(async (name) => (await (await caches.open(name)).match('/app')).text(), oldCache);
    expect(oldShell).not.toContain('/vendor/maplibre/');
    upgraded = true;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 15000 }).toEqual([
      'mesh-health-check-pwa-v1.4.0-code-guidance-18',
    ]);
    const cached = await page.evaluate(async () => {
      const cache = await caches.open('mesh-health-check-pwa-v1.4.0-code-guidance-18');
      return { paths: (await cache.keys()).map((request) => new URL(request.url).pathname), shell: await (await cache.match('/app')).text() };
    });
    expect(cached.paths).toEqual(expect.arrayContaining([
      '/map-renderer.js', '/vendor/maplibre/maplibre-gl.mjs',
      '/vendor/maplibre/maplibre-gl-shared.mjs', '/vendor/maplibre/maplibre-gl-worker.mjs',
      '/vendor/maplibre/maplibre-gl.css', '/vendor/maplibre-leaflet/leaflet-maplibre-gl.js',
    ]));
    expect(cached.shell).toContain('/app.js');
    const source = await fs.readFile(new URL('../../public/app.js', import.meta.url), 'utf8');
    expect(await page.evaluate(async () => (await caches.match('/app.js')).text())).toBe(source);
    expect(await page.evaluate(async () => (await (await caches.open('mesh-health-check-pwa-v1.4.0-code-guidance-18')).keys()).every((r) => new URL(r.url).origin === location.origin))).toBe(true);
  } finally {
    await context.close();
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
});
