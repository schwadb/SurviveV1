// E2E orchestrator: export the web build, serve it, run every drive,
// tear the server down, and exit non-zero if any drive failed.
import { spawn, spawnSync } from 'node:child_process';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('..', import.meta.url).pathname;
const PORT = process.env.E2E_PORT ?? '4173';
const DRIVES = ['drive-app.mjs', 'drive-import.mjs', 'drive-improvements.mjs', 'drive-merge.mjs', 'drive-scale.mjs'];

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  return res.status ?? 1;
}

if (!process.env.E2E_SKIP_BUILD) {
  console.log('▸ expo export --platform web');
  if (sh('npx', ['expo', 'export', '--platform', 'web']) !== 0) process.exit(1);
}

console.log(`▸ serving dist on :${PORT}`);
const server = spawn('npx', ['serve', '-l', PORT, 'dist'], { cwd: ROOT, stdio: 'ignore' });

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let failed = 0;
try {
  if (!(await waitForServer())) {
    console.error('server never came up');
    process.exitCode = 1;
  } else {
    for (const drive of DRIVES) {
      console.log(`▸ ${drive}`);
      const code = sh('node', [HERE + drive], {
        env: { ...process.env, E2E_URL: `http://localhost:${PORT}/` },
      });
      if (code !== 0) {
        failed++;
        console.error(`✗ ${drive} failed`);
      }
    }
    process.exitCode = failed ? 1 : 0;
  }
} finally {
  server.kill();
}
console.log(failed ? `✗ ${failed} drive(s) failed` : '✓ all drives passed');
