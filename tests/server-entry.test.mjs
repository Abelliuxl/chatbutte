import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('production gateway starts through the active-release directory symlink', async () => {
  const chooser = http.createServer();
  chooser.listen(0, '127.0.0.1');
  await once(chooser, 'listening');
  const port = chooser.address().port;
  await new Promise((resolve) => chooser.close(resolve));
  const temp = await mkdtemp(path.join(os.tmpdir(), 'chatbutte-release-test-'));
  const active = path.join(temp, 'active');
  await symlink(process.cwd(), active, 'dir');
  const child = spawn(process.execPath, [path.join(active, 'server/index.mjs')], {
    cwd: active,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CHATBUTTE_ORIGINS: '',
      CHATBUTTE_PASSWORD: '',
    },
    stdio: 'pipe',
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    let health;
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch {}
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(health?.version, '2.0.0', `Gateway did not start through symlink: ${stderr}`);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    await rm(temp, { recursive: true, force: true });
  }
});
