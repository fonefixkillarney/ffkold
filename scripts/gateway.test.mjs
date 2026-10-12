import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createGateway } from './gateway.mjs';

test('one domain routes API methods, bodies, auth and query strings; website goes to Next', async (t) => {
  const mock = async (name) => {
    const server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      if (name === 'backend') res.setHeader('Set-Cookie', 'session=example; HttpOnly');
      res.end(JSON.stringify({ name, url: req.url, method: req.method, body, auth: req.headers.authorization }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    return server.address().port;
  };
  const gateway = createGateway({ frontendPort: await mock('frontend'), backendPort: await mock('backend') });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(() => { gateway.closeAllConnections(); gateway.close(); });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const response = await fetch(`${base}/api/orders?source=cart`, {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: '{"quantity":2}',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), 'session=example; HttpOnly');
  assert.deepEqual(await response.json(), { name: 'backend', url: '/api/orders?source=cart', method: 'POST', body: '{"quantity":2}', auth: 'Bearer test-token' });
  for (const route of ['/', '/admin/login', '/_next/static/example.js', '/apiary']) {
    assert.equal((await (await fetch(base + route)).json()).name, 'frontend');
  }
  assert.equal((await (await fetch(base + '/api')).json()).name, 'backend');
});

test('unavailable upstream gives a controlled 502', async (t) => {
  const unavailable = http.createServer();
  unavailable.listen(0, '127.0.0.1');
  await once(unavailable, 'listening');
  const port = unavailable.address().port;
  await new Promise(resolve => unavailable.close(resolve));
  const gateway = createGateway({ frontendPort: port, backendPort: port });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(() => { gateway.closeAllConnections(); gateway.close(); });
  const response = await fetch(`http://127.0.0.1:${gateway.address().port}/api/products`);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).message, 'Application service unavailable');
});
