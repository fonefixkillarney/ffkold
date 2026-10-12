import http from 'node:http';

export function createGateway({ frontendPort, backendPort }) {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const port = pathname === '/api' || pathname.startsWith('/api/') ? backendPort : frontendPort;
    const upstream = http.request({
      hostname: '127.0.0.1', port, path: req.url, method: req.method,
      headers: {
        ...req.headers,
        'x-forwarded-host': req.headers.host,
        'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http',
      },
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Application service unavailable' }));
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
  });
}
