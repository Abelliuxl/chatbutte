import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetch } from 'undici';
import { z } from 'zod';
import { readSSE } from '../shared/sse.mjs';
import {
  validateTarget,
  dispatcher,
  sameOrigin,
  trustedHost,
  clientAddress,
  redact,
} from './security.mjs';

const root = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const MAX_BODY = 32 * 1024 * 1024;
const profileSchema = z.object({
  apiUrl: z.string().max(2048),
  apiKey: z.string().max(4096).optional().default(''),
  model: z.string().min(1).max(200),
  reasoning: z.enum(['default', 'on', 'off']).default('default'),
  sendTemperature: z.boolean().default(true),
  thinkingFormat: z
    .enum(['enable_thinking', 'thinking', 'reasoning_effort'])
    .default('enable_thinking'),
  imageFormat: z.enum(['openai', 'dashscope']).default('openai'),
});
const chatSchema = z.object({
  profile: profileSchema,
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.union([
          z.string().max(2_000_000),
          z
            .array(
              z.union([
                z.object({ type: z.literal('text'), text: z.string().max(2_000_000) }),
                z.object({
                  type: z.literal('image_url'),
                  image_url: z.object({
                    url: z
                      .string()
                      .max(12_000_000)
                      .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/),
                  }),
                }),
              ]),
            )
            .max(11),
        ]),
      }),
    )
    .min(1)
    .max(205),
  temperature: z.number().min(0).max(2),
});
const imageSchema = z.object({
  profile: profileSchema,
  prompt: z.string().min(1).max(100000),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
});
const sessions = new Map();
const rates = new Map();
let active = 0;
const password = process.env.CHATBUTTE_PASSWORD || '';
const secureHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.github.com https://gist.githubusercontent.com; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};
function json(res, status, body) {
  if (!res.headersSent)
    res.writeHead(status, {
      ...secureHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json'))
    throw Object.assign(new Error('Expected application/json'), { status: 415 });
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request exceeds 32 MB'), { status: 413 });
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}
function auth(req) {
  if (!password) return true;
  const token = /(?:^|;\s*)chatbutte_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}
function admit(req) {
  const id = `${clientAddress(req)}:${req.url?.endsWith('/login') ? 'login' : auth(req) ? 'authenticated' : 'guest'}`;
  const now = Date.now();
  let rate = rates.get(id);
  if (!rate || rate.reset < now) {
    rate = { count: 0, reset: now + 60_000 };
    rates.set(id, rate);
  }
  if (rates.size > 10000)
    for (const [key, value] of rates) if (value.reset < now) rates.delete(key);
  if (++rate.count > (req.url?.endsWith('/login') ? 10 : 60) || active >= 6)
    throw Object.assign(new Error('Too many requests. Please wait a moment.'), { status: 429 });
}
async function upstream(url, key, payload, signal, request = fetch) {
  const target = validateTarget(url);
  const response = await request(target, {
    method: 'POST',
    dispatcher,
    redirect: 'error',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await limitedText(response, 64_000);
    let message;
    try {
      const e = JSON.parse(detail);
      message = e.error?.message || e.message;
    } catch {}
    throw Object.assign(
      new Error(
        `Upstream ${response.status}: ${redact(message || detail || response.statusText, [key])}`,
      ),
      { status: 502 },
    );
  }
  return response;
}
async function limitedText(response, max = 32_000_000) {
  let length = 0;
  const parts = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > max) throw new Error('Upstream response too large');
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts).toString('utf8');
}
const contentText = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((x) => x.type === 'text')
          .map((x) => x.text || '')
          .join('')
      : '';
async function emit(res, item, signal) {
  if (res.destroyed || signal?.aborted) throw new Error('Client disconnected');
  if (res.write(`data: ${JSON.stringify(item)}\n\n`)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', drain);
      res.off('close', close);
      res.off('error', close);
      signal?.removeEventListener('abort', close);
    };
    const drain = () => {
      cleanup();
      resolve();
    };
    const close = () => {
      cleanup();
      reject(new Error('Stream cancelled while waiting for the client'));
    };
    res.once('drain', drain);
    res.once('close', close);
    res.once('error', close);
    signal?.addEventListener('abort', close, { once: true });
    if (res.destroyed || signal?.aborted) close();
  });
}
export async function relayChat(response, res, signal) {
  let terminal = false,
    textSize = 0,
    reasoningSize = 0;
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
    const result = JSON.parse(await limitedText(response));
    if (result.error) throw new Error(result.error.message || 'Upstream error');
    const message = result.choices?.[0]?.message;
    if (!message)
      throw new Error(
        'Response has no assistant message. This endpoint may not support Chat Completions.',
      );
    const content = contentText(message.content),
      reasoning = contentText(message.reasoning_content || message.reasoning);
    if (content.length > 2_000_000 || reasoning.length > 2_000_000)
      throw new Error('Generated output exceeds limit');
    await emit(res, { type: 'delta', content, reasoning }, signal);
    await emit(res, { type: 'done', reason: result.choices[0].finish_reason || 'stop' }, signal);
    return;
  }
  for await (const event of readSSE(response.body)) {
    if (event.data === '[DONE]') {
      terminal = true;
      break;
    }
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      throw new Error('Malformed JSON in upstream stream');
    }
    if (data.error || event.event === 'error')
      throw new Error(data.error?.message || data.message || 'Upstream stream error');
    const choice = data.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || choice.message || {};
    const content = contentText(delta.content),
      reasoning = contentText(delta.reasoning_content || delta.reasoning);
    textSize += content.length;
    reasoningSize += reasoning.length;
    if (textSize > 2_000_000 || reasoningSize > 2_000_000)
      throw new Error('Generated output exceeds limit');
    if (content || reasoning) await emit(res, { type: 'delta', content, reasoning }, signal);
    if (choice.finish_reason) {
      terminal = true;
      await emit(res, { type: 'done', reason: choice.finish_reason }, signal);
      return;
    }
  }
  if (!terminal)
    throw new Error('Connection closed before completion. Partial response has been kept.');
  await emit(res, { type: 'done', reason: 'stop' }, signal);
}
async function generateImages(response, format) {
  const result = JSON.parse(await limitedText(response));
  if (result.error || result.code)
    throw new Error(result.error?.message || result.message || 'Image generation failed');
  let images = [];
  if (format === 'dashscope') {
    for (const choice of result.output?.choices || []) {
      const parts = choice.message?.content || [];
      const revisedPrompt = parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join('\n');
      images.push(
        ...parts
          .filter((p) => p.image || p.url)
          .map((p) => ({ url: p.image || p.url, revisedPrompt })),
      );
    }
  } else
    images = (result.data || []).map((p) => ({
      url: p.url || (p.b64_json ? `data:image/png;base64,${p.b64_json}` : ''),
      revisedPrompt: p.revised_prompt,
    }));
  images = images
    .filter(
      (x) =>
        typeof x.url === 'string' &&
        (/^https:\/\//.test(x.url) ||
          /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(x.url)),
    )
    .slice(0, 10);
  if (!images.length)
    throw new Error(
      result.output?.task_id
        ? 'This provider returned an asynchronous task. Use a synchronous image endpoint.'
        : 'No images returned. Check the image protocol and endpoint.',
    );
  return images;
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
export function createServer({ request = fetch } = {}) {
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return json(res, 400, { error: 'Invalid request URL' });
    }
    if (!trustedHost(req))
      return json(res, 403, {
        error: 'Untrusted Host. Configure CHATBUTTE_ORIGINS for this deployment.',
      });
    let route = url.pathname;
    if (route.startsWith('/chatbutte/')) route = route.slice('/chatbutte'.length);
    if (route.startsWith('/api/')) {
      let controller;
      let counted = false;
      let key = '';
      try {
        if (!sameOrigin(req))
          return json(res, 403, { error: 'Cross-origin requests are not allowed.' });
        if (route === '/api/health' && req.method === 'GET')
          return json(res, 200, {
            ok: true,
            version: '2.0.0',
            authRequired: !!password && !auth(req),
          });
        admit(req);
        active++;
        counted = true; // Reserve synchronously, before reading any request body.
        if (route === '/api/login' && req.method === 'POST') {
          const value = await body(req);
          const given = crypto
            .createHash('sha256')
            .update(String(value.password || ''))
            .digest();
          const expected = crypto.createHash('sha256').update(password).digest();
          if (!crypto.timingSafeEqual(given, expected))
            return json(res, 401, { error: 'Incorrect password / 密码不正确' });
          for (const [token, expiry] of sessions) if (expiry < Date.now()) sessions.delete(token);
          if (sessions.size > 1000) sessions.delete(sessions.keys().next().value);
          const token = crypto.randomBytes(32).toString('hex');
          sessions.set(token, Date.now() + 7 * 86400_000);
          res.setHeader(
            'Set-Cookie',
            `chatbutte_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : ''}`,
          );
          return json(res, 200, { ok: true });
        }
        if (!auth(req))
          return json(res, 401, { error: 'Please unlock this workspace / 请先输入访问密码' });
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        if (!['/api/chat', '/api/images'].includes(route))
          return json(res, 404, { error: 'Not found' });
        const parsed = (route === '/api/chat' ? chatSchema : imageSchema).parse(await body(req));
        const p = parsed.profile;
        key = p.apiKey;
        controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(new Error('Request timed out after 5 minutes')),
          300_000,
        );
        res.on('close', () => {
          clearTimeout(timer);
          controller.abort();
        });
        if (route === '/api/chat') {
          const payload = {
            model: p.model,
            messages: parsed.messages,
            stream: true,
            ...(p.sendTemperature ? { temperature: parsed.temperature } : {}),
          };
          if (p.reasoning !== 'default') {
            const on = p.reasoning === 'on';
            if (p.thinkingFormat === 'thinking')
              payload.thinking = { type: on ? 'enabled' : 'disabled' };
            else if (p.thinkingFormat === 'reasoning_effort')
              payload.reasoning_effort = on ? 'medium' : 'none';
            else payload.enable_thinking = on;
          }
          const response = await upstream(p.apiUrl, p.apiKey, payload, controller.signal, request);
          res.writeHead(200, {
            ...secureHeaders,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            Connection: 'keep-alive',
          });
          res.flushHeaders();
          const heartbeat = setInterval(() => {
            if (!res.destroyed && !res.writableNeedDrain) res.write(': keep-alive\n\n');
          }, 15_000);
          try {
            await relayChat(response, res, controller.signal);
          } finally {
            clearInterval(heartbeat);
          }
          res.end();
        } else {
          const payload =
            p.imageFormat === 'dashscope'
              ? {
                  model: p.model,
                  input: { messages: [{ role: 'user', content: [{ text: parsed.prompt }] }] },
                  parameters: {
                    size: parsed.size.replace('x', '*'),
                    n: 1,
                    prompt_extend: true,
                    watermark: false,
                  },
                }
              : { model: p.model, prompt: parsed.prompt, n: 1, size: parsed.size };
          const response = await upstream(p.apiUrl, p.apiKey, payload, controller.signal, request);
          json(res, 200, { images: await generateImages(response, p.imageFormat) });
        }
      } catch (error) {
        const message =
          error instanceof z.ZodError
            ? 'Invalid request / 请求参数无效'
            : redact(error.message || error.cause?.message || 'Request failed', [key]);
        if (res.headersSent) {
          if (!res.destroyed) res.end(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
        } else
          json(res, error.status || (error instanceof z.ZodError ? 400 : 502), { error: message });
      } finally {
        if (counted) active--;
        controller?.abort();
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method))
      return json(res, 405, { error: 'Method not allowed' });
    try {
      let decoded;
      try {
        decoded = decodeURIComponent(route);
      } catch {
        return json(res, 400, { error: 'Invalid path' });
      }
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      if (relative.split('/').some((p) => p.startsWith('.')) || relative.includes('\\'))
        return json(res, 404, { error: 'Not found' });
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) return json(res, 404, { error: 'Not found' });
      const info = await stat(file);
      if (!info.isFile()) return json(res, 404, { error: 'Not found' });
      const extension = path.extname(file);
      if (!MIME[extension]) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        ...secureHeaders,
        'Content-Type': MIME[extension],
        'Cache-Control': relative.startsWith('assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'Content-Length': info.size,
      });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch {
      json(res, 404, { error: 'Not found' });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1',
    port = Number(process.env.PORT || 8080);
  if (!password && process.env.CHATBUTTE_ORIGINS && process.env.CHATBUTTE_PUBLIC !== '1')
    throw new Error(
      'Set CHATBUTTE_PASSWORD or explicitly set CHATBUTTE_PUBLIC=1 for a public deployment.',
    );
  const server = createServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.listen(port, host, () => console.log(`Chatbutte 2.0 listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
}
