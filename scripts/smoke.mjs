// Production HTTP smoke check with a mock API; never connects to MongoDB.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createGateway } from './gateway.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const listen = async server => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const reservation = http.createServer();
const frontendPort = await listen(reservation);
await new Promise(resolve => reservation.close(resolve));
const api = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true, data: [], mock: true }));
});
const backendPort = await listen(api);
const gateway = createGateway({ frontendPort, backendPort });
const port = await listen(gateway);
const child = spawn(process.execPath, [`${root}/frontend/node_modules/next/dist/bin/next`, 'start', '-p', String(frontendPort), '-H', '127.0.0.1'], {
  cwd: `${root}/frontend`, env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Frontend did not become ready: ${output}`);
  for (const route of ['/', '/admin/login', '/cart']) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    const html = await response.text();
    if (!response.ok || !html.includes('<html')) throw new Error(`${route}: invalid website response`);
    console.log(`PASS production HTML through gateway: ${route}`);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/products`);
  if (!(await response.json()).mock) throw new Error('API was not routed to the mock backend');
  console.log('PASS /api/products through the same gateway (mock backend; no database access)');
} finally {
  gateway.closeAllConnections(); gateway.close();
  api.closeAllConnections(); api.close();
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
}
