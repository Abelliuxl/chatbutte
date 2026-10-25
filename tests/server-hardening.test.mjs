import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer, relayChat } from '../server/index.mjs';
import {
  checkedLookup,
  sameOrigin,
  trustedHost,
  clientAddress,
  redact,
} from '../server/security.mjs';
const p = {
  apiUrl: 'https://example.com/v1/chat/completions',
  model: 'fixture',
  apiKey: '',
  sendTemperature: false,
};
const body = { profile: p, messages: [{ role: 'user', content: 'hi' }], temperature: 0 };
test('connection DNS lookup rejects private and mixed public/private answers', async () => {
  for (const answers of [
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    [{ address: '::ffff:192.168.1.1', family: 6 }],
  ])
    await assert.rejects(
      new Promise((resolve, reject) =>
        checkedLookup(
          'example.com',
          { all: true },
          (e, value) => (e ? reject(e) : resolve(value)),
          (host, options, cb) => cb(null, answers),
        ),
      ),
      /private/,
    );
});
test('connection DNS lookup returns precisely the checked addresses', async () => {
  const answers = [{ address: '1.1.1.1', family: 4 }];
  const actual = await new Promise((resolve, reject) =>
    checkedLookup(
      'example.com',
      { all: true },
      (e, value) => (e ? reject(e) : resolve(value)),
      (host, options, cb) => cb(null, answers),
    ),
  );
  assert.equal(actual, answers);
});
test('untrusted Host cannot pass by matching its own Origin', () => {
  const req = {
    headers: { host: 'attacker.invalid', origin: 'https://attacker.invalid' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  assert.equal(trustedHost(req), false);
  assert.equal(sameOrigin(req), false);
  assert.equal(
    sameOrigin({ ...req, headers: { host: 'localhost:8080', origin: 'http://localhost:8080' } }),
    true,
  );
});
test('proxy IP is trusted only when explicitly configured and peer is loopback', () => {
  const req = { headers: { 'x-real-ip': '1.1.1.1' }, socket: { remoteAddress: '8.8.8.8' } };
  const before = process.env.CHATBUTTE_TRUST_PROXY;
  process.env.CHATBUTTE_TRUST_PROXY = 'loopback';
  assert.equal(clientAddress(req), '8.8.8.8');
  assert.equal(clientAddress({ ...req, socket: { remoteAddress: '127.0.0.1' } }), '1.1.1.1');
  if (before === undefined) delete process.env.CHATBUTTE_TRUST_PROXY;
  else process.env.CHATBUTTE_TRUST_PROXY = before;
});
test('long secrets are removed before error truncation', () => {
  const secret = 'PRIVATE'.repeat(600);
  assert.doesNotMatch(redact('prefix ' + secret, [secret]), /PRIVATE/);
  assert.doesNotMatch(redact('x'.repeat(1995) + secret, [secret]), /PRIVATE/);
});
test('backpressure cancellation releases all drain and close listeners', async () => {
  for (const kind of ['abort', 'close']) {
    const res = new EventEmitter();
    res.destroyed = false;
    res.write = () => false;
    const signal = new AbortController();
    const response = new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const run = relayChat(response, res, signal.signal);
    setTimeout(() => (kind === 'abort' ? signal.abort() : res.emit('close')), 10);
    await assert.rejects(run, /cancelled/);
    assert.equal(res.listenerCount('drain'), 0);
    assert.equal(res.listenerCount('close'), 0);
  }
});
test('concurrency is reserved before any asynchronous body read', async () => {
  let requests = 0;
  const server = createServer({
    request: async () => {
      requests++;
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const held = [];
  try {
    for (let i = 0; i < 6; i++) {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 100 },
      });
      req.on('error', () => {});
      req.write('{');
      held.push(req);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 429);
    assert.equal(requests, 0);
    held.forEach((r) => r.destroy());
    await new Promise((resolve) => setTimeout(resolve, 80));
    const next = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(next.status, 200);
    await next.text();
    assert.equal(requests, 1);
  } finally {
    held.forEach((r) => r.destroy());
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test('temperature omission supports strict reasoning models', async () => {
  const server = createServer({
    request: async (url, options) => {
      assert.equal(JSON.parse(options.body).temperature, undefined);
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);
    await r.text();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test('optional access password gates API and authenticates with an HttpOnly cookie', async () => {
  const chooser = http.createServer();
  chooser.listen(0, '127.0.0.1');
  await once(chooser, 'listening');
  const port = chooser.address().port;
  await new Promise((resolve) => chooser.close(resolve));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), CHATBUTTE_PASSWORD: 'fixture-password' },
    stdio: 'pipe',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).authRequired, true);
    const post = (route, value, cookie = '') =>
      fetch(`${base}/api/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(value),
      });
    assert.equal((await post('chat', body)).status, 401);
    assert.equal((await post('login', { password: 'wrong' })).status, 401);
    const login = await post('login', { password: 'fixture-password' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await post('chat', { invalid: true }, cookie.split(';')[0])).status, 400);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});
