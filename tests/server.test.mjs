import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server/index.mjs';
import { publicIP, validateTarget, redact } from '../server/security.mjs';
const profile = {
  apiUrl: 'https://example.com/v1/chat/completions',
  apiKey: 'test-secret',
  model: 'mock',
  reasoning: 'default',
};
const payload = { profile, messages: [{ role: 'user', content: 'hello' }], temperature: 0 };
async function withServer(request, fn) {
  const server = createServer({ request });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
async function post(base, body = payload, route = 'chat', headers = {}) {
  return fetch(`${base}/api/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const sse = (events) =>
  new Response(
    events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
test('public IP classifier rejects private/reserved IPv4 and IPv6', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '224.0.0.1',
  ])
    assert.equal(publicIP(ip), false, ip);
  assert.equal(publicIP('1.1.1.1'), true);
  assert.equal(publicIP('2606:4700:4700::1111'), true);
});
test('target validator rejects insecure URLs and credentials', () => {
  for (const url of [
    'http://example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://example.com:8080',
    'https://user:pass@example.com',
    'https://localhost',
    'https://test.local',
  ])
    assert.throws(() => validateTarget(url));
  assert.equal(validateTarget('https://example.com/v1').hostname, 'example.com');
});
test('secrets are removed from error text', () =>
  assert.equal(redact('key=abc Bearer xyz', ['abc']), 'key=[redacted] Bearer [redacted]'));
test('streams content and reasoning, preserving temperature=0 and default fields', async () => {
  await withServer(
    async (url, options) => {
      assert.equal(String(url), profile.apiUrl);
      const body = JSON.parse(options.body);
      assert.equal(body.temperature, 0);
      assert.equal(body.enable_thinking, undefined);
      assert.equal(options.redirect, 'error');
      return sse([
        { choices: [{ delta: { reasoning_content: 'think' } }] },
        { choices: [{ delta: { content: '你好🌱' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        '[DONE]',
      ]);
    },
    async (base) => {
      const r = await post(base);
      assert.equal(r.status, 200);
      const text = await r.text();
      assert.match(text, /你好🌱/);
      assert.match(text, /"reasoning":"think"/);
      assert.equal((text.match(/"type":"done"/g) || []).length, 1);
    },
  );
});
test('renders non-streaming JSON fallback as a normal delta', async () =>
  withServer(
    async () =>
      Response.json({ choices: [{ message: { content: 'JSON reply' }, finish_reason: 'stop' }] }),
    async (base) => {
      const text = await (await post(base)).text();
      assert.match(text, /JSON reply/);
      assert.match(text, /"type":"done"/);
    },
  ));
test('truncated upstream produces a stream error and preserves partial content', async () =>
  withServer(
    async () => sse([{ choices: [{ delta: { content: 'partial' } }] }]),
    async (base) => {
      const text = await (await post(base)).text();
      assert.match(text, /partial/);
      assert.match(text, /"type":"error"/);
      assert.doesNotMatch(text, /"type":"done"/);
    },
  ));
test('malformed or upstream error events are explicit failures', async () => {
  for (const events of [['{bad}'], [{ error: { message: 'Provider failed' } }]])
    await withServer(
      async () => sse(events),
      async (base) => {
        assert.match(await (await post(base)).text(), /"type":"error"/);
      },
    );
});
test('only the chosen reasoning control field is sent', async () =>
  withServer(
    async (url, options) => {
      const p = JSON.parse(options.body);
      assert.deepEqual(p.thinking, { type: 'disabled' });
      assert.equal(p.enable_thinking, undefined);
      return sse(['[DONE]']);
    },
    async (base) => {
      assert.equal(
        (
          await post(base, {
            ...payload,
            profile: { ...profile, reasoning: 'off', thinkingFormat: 'thinking' },
          })
        ).status,
        200,
      );
    },
  ));
test('rejects invalid payload and cross-origin request before upstream', async () =>
  withServer(
    async () => {
      throw new Error('must not call');
    },
    async (base) => {
      assert.equal((await post(base, { ...payload, temperature: 9 })).status, 400);
      assert.equal(
        (await post(base, payload, 'chat', { Origin: 'https://evil.example' })).status,
        403,
      );
      assert.equal(
        (await post(base, payload, 'chat', { 'Sec-Fetch-Site': 'cross-site' })).status,
        403,
      );
      assert.equal((await fetch(`${base}/api/chat`)).status, 405);
    },
  ));
test('rejects private endpoint before fetch and redacts upstream keys', async () =>
  withServer(
    async () => Response.json({ error: { message: 'Bad key test-secret' } }, { status: 401 }),
    async (base) => {
      const rejected = await post(base, {
        ...payload,
        profile: { ...profile, apiUrl: 'https://127.0.0.1' },
      });
      assert.equal(rejected.status, 502);
      const response = await post(base);
      const text = await response.text();
      assert.equal(response.status, 502);
      assert.doesNotMatch(text, /test-secret/);
      assert.match(text, /redacted/);
    },
  ));
test('OpenAI and DashScope image fixtures adapt independently', async () => {
  for (const format of ['openai', 'dashscope'])
    await withServer(
      async (url, options) => {
        const data = JSON.parse(options.body);
        if (format === 'openai') {
          assert.equal(data.prompt, 'draw');
          return Response.json({ data: [{ b64_json: 'YWJj', revised_prompt: 'revised' }] });
        }
        assert.equal(data.input.messages[0].content[0].text, 'draw');
        return Response.json({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: 'https://example.com/image.png' }, { text: 'revised' }],
                },
              },
            ],
          },
        });
      },
      async (base) => {
        const r = await post(
          base,
          { profile: { ...profile, imageFormat: format }, prompt: 'draw' },
          'images',
        );
        assert.equal(r.status, 200);
        const result = await r.json();
        assert.equal(result.images.length, 1);
        assert.equal(result.images[0].revisedPrompt, 'revised');
      },
    );
});
test('async image tasks fail with an actionable message', async () =>
  withServer(
    async () => Response.json({ output: { task_id: '123' } }),
    async (base) => {
      const r = await post(base, { profile, prompt: 'draw' }, 'images');
      assert.equal(r.status, 502);
      assert.match(await r.text(), /asynchronous/);
    },
  ));
test('client cancellation aborts the upstream signal', async () => {
  let signal;
  await withServer(
    async (url, options) => {
      signal = options.signal;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'),
            );
            options.signal.addEventListener('abort', () => {
              try {
                c.close();
              } catch {}
            });
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
    async (base) => {
      const controller = new AbortController();
      const r = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const reader = r.body.getReader();
      await reader.read();
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(signal.aborted, true);
    },
  );
});
test('health and static whitelist do not expose source files', async () =>
  withServer(
    async () => {},
    async (base) => {
      assert.equal((await fetch(`${base}/api/health`)).status, 200);
      for (const file of ['/server/index.mjs', '/package.json', '/.env', '/src/main.tsx'])
        assert.equal((await fetch(base + file)).status, 404);
      assert.equal((await fetch(`${base}/chatbutte/`)).status, 200);
    },
  ));
