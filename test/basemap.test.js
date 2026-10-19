import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.MESH_HEALTH_DISABLE_RUNTIME = 'true';
process.env.TURNSTILE_ENABLED = 'false';
process.env.CARTO_BASEMAP_KEY = '';
const { server } = await import('../server.js');
let baseUrl;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('keyless sites advertise a dark basemap', async () => {
  const bootstrap = await (await fetch(`${baseUrl}/api/bootstrap`)).json();
  assert.equal(bootstrap.map.cartoBasemapKey, '');
  assert.equal(bootstrap.map.darkBasemapAvailable, true);
});

test('dashboard and shared results serve pinned local CSP renderer assets', async () => {
  for (const asset of [
    '/vendor/maplibre/maplibre-gl-csp.js',
    '/vendor/maplibre/maplibre-gl-csp-worker.js',
    '/vendor/maplibre/maplibre-gl.css',
    '/vendor/maplibre-leaflet/leaflet-maplibre-gl.js',
  ]) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-type'), asset.endsWith('.css') ? /text\/css/ : /javascript/, asset);
    assert.ok((await response.text()).length > 100, asset);
  }
  const response = await fetch(`${baseUrl}/app`);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /connect-src[^;]*https:\/\/tiles\.openfreemap\.org/);
  assert.match(csp, /worker-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval|worker-src[^;]*blob:/);
  const html = await response.text();
  assert.match(html, /\/vendor\/maplibre\/maplibre-gl-csp.js/);
  assert.match(html, /\/vendor\/maplibre-leaflet\/leaflet-maplibre-gl.js/);
});
