import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(workspace, '.watch-verify-'));
assert(directory.startsWith(path.join(workspace, '.watch-verify-')));
const dist = path.join(directory, 'dist');
const bundle = path.join(dist, 'main.js');
let watcher;
let output = '';
const fixturePids = new Set();
const fakeBundle = (version) => `console.log('FIXTURE_PID:' + process.pid); console.log('${version}'); setInterval(() => {}, 1000);`;

async function waitFor(text) {
  const deadline = Date.now() + 20000;
  while (!output.includes(text)) {
    if (Date.now() > deadline) throw new Error(`Watcher did not report ${text}: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

try {
  await mkdir(dist);
  await writeFile(bundle, fakeBundle('INITIAL'));
  await copyFile(path.join(workspace, 'backend', 'watch-server.js'), path.join(directory, 'watch-server.js'));
  watcher = spawn(process.execPath, [path.join(directory, 'watch-server.js')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  watcher.stdout.on('data', (chunk) => {
    output += chunk.toString();
    for (const match of output.matchAll(/FIXTURE_PID:(\d+)/g)) fixturePids.add(Number(match[1]));
  });
  watcher.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitFor('INITIAL');
  assert.equal((output.match(/Starting server/g) || []).length, 1);
  // Only this script's verified temporary directory is deleted.
  assert.equal(path.dirname(dist), directory);
  await rm(dist, { recursive: true });
  await mkdir(dist);
  await writeFile(bundle, fakeBundle('RECREATED'));
  await waitFor('RECREATED');
  console.log('PASS recreating dist restarts the server with the new bundle');
  await appendFile(bundle, "\nconsole.log('UPDATED');\n");
  await waitFor('UPDATED');
  assert.equal((output.match(/Starting server/g) || []).length, 3);
  console.log('PASS later bundle changes remain watched and start only one replacement');
} finally {
  for (const pid of fixturePids) { try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  if (watcher && watcher.exitCode === null && watcher.signalCode === null) {
    const stopped = new Promise((resolve) => watcher.once('exit', resolve));
    watcher.kill();
    await stopped;
  }
  assert(directory.startsWith(path.join(workspace, '.watch-verify-')));
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
