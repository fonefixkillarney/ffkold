import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGateway } from './gateway.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 3000);
const backendPort = 5000;
const frontendPort = 3001;
if (!Number.isInteger(port) || port < 1 || port > 65535 || [backendPort, frontendPort].includes(port)) {
  throw new Error('PORT must be a valid port other than internal ports 3001 and 5000');
}
if (!process.env.MONGO_URI || !process.env.JWT_SECRET || !process.env.CLIENT_URL) {
  throw new Error('Set MONGO_URI, JWT_SECRET and CLIENT_URL in the deployment environment');
}
let stopping = false;
const children = [];
const gateway = createGateway({ frontendPort, backendPort });
function stop(code) {
  if (stopping) return;
  stopping = true;
  gateway.close();
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 5000);
  Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null) resolve(); else child.once('exit', resolve);
  }))).then(() => { clearTimeout(timer); process.exit(code); });
}
function launch(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => { if (!stopping) stop(code || 1); });
}
launch(['server.js'], path.join(root, 'backend'), {
  PORT: String(backendPort), MONTHLY_REMINDER: process.env.MONTHLY_REMINDER || 'off',
  SCRAPE_INTERVAL_HOURS: process.env.SCRAPE_INTERVAL_HOURS || '0',
});
launch([path.join(root, 'frontend/node_modules/next/dist/bin/next'), 'start', '-p', String(frontendPort), '-H', '127.0.0.1'], path.join(root, 'frontend'), { PORT: String(frontendPort) });
gateway.on('error', (error) => { console.error(error.message); stop(1); });
gateway.listen(port, '0.0.0.0', () => console.log(`Combined FFK application listening on ${port}`));
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
