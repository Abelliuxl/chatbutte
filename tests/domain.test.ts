import { describe, expect, it } from 'vitest';
import {
  endpoint,
  contextMessages,
  newConversation,
  emptyState,
  exportState,
  type Message,
} from '../src/domain';
import { parseImport } from '../src/migration';
import { readSSE } from '../shared/sse.mjs';
const legacy = () => ({
  profiles: [
    {
      id: 'p',
      name: 'Model',
      apiUrl: 'https://example.com/v1',
      apiKey: 'secret',
      model: 'model',
      type: 'chat',
      reasoningMode: 'on',
    },
  ],
  topics: [
    {
      id: 't',
      name: 'Topic',
      prompt: 'Be concise',
      historyCount: 0,
      temperature: 0,
      activeProfileId: 'p',
    },
  ],
  messagesByTopic: {
    t: [
      { id: 'm1', role: 'user', content: 'hello', time: 10 },
      { id: 'm2', role: 'context_cutoff', content: '', time: 20 },
      { id: 'm3', role: 'assistant', content: 'reply', time: 30, reasoning: 'think' },
    ],
  },
  activeTopicId: 't',
  activeProfileId: 'p',
  settings: { theme: 'dark', sendKey: 'cmd' },
  gistToken: 'token',
});
describe('legacy migration', () => {
  it('preserves parameters, reasoning, references and zero values', () => {
    const s = parseImport(legacy());
    expect(s.version).toBe(2);
    expect(s.conversations[0]).toMatchObject({
      temperature: 0,
      historyCount: 0,
      profileId: 'p',
      prompt: 'Be concise',
    });
    expect(s.profiles[0].reasoning).toBe('on');
    expect(s.conversations[0].messages[1].role).toBe('divider');
    expect(s.conversations[0].messages[2].reasoning).toBe('think');
    expect(s.settings.sendKey).toBe('mod');
  });
  it('marks attachments lost by the old implementation', () => {
    const input = legacy();
    input.messagesByTopic.t.push({
      id: 'm4',
      role: 'user',
      content: '',
      time: 40,
      attachments: [
        { id: 'a', kind: 'image', name: 'old.png', type: 'image/png', size: 100, hadDataUrl: true },
      ],
    } as never);
    const a = parseImport(input).conversations[0].messages[3].attachments[0];
    expect(a.kind).toBe('unavailable');
    expect(a.note).toContain('not saved');
  });
  it('recovers orphan conversations instead of throwing their messages away', () => {
    const input = legacy();
    Object.assign(input.messagesByTopic, {
      orphan: [{ id: 'o', role: 'user', content: 'keep me', time: 1 }],
    });
    expect(parseImport(input).conversations[1].messages[0].content).toBe('keep me');
  });
  it('splits explicit dual profiles, does not invent image models', () => {
    const input = legacy();
    Object.assign(input.profiles[0], {
      type: undefined,
      imageApiUrl: 'https://example.com/image',
      imageModel: 'image',
    });
    expect(parseImport(input).profiles.map((p) => p.id)).toEqual(['p', 'p-image']);
    delete (input.profiles[0] as Record<string, unknown>).imageModel;
    expect(parseImport(input).profiles).toHaveLength(1);
  });
  it('rejects corrupt and duplicate data before replacement', () => {
    expect(() => parseImport({ topics: [] })).toThrow();
    const input = legacy();
    input.topics.push(input.topics[0]);
    expect(() => parseImport(input)).toThrow(/Duplicate/);
  });
  it('marks interrupted generations on reload and keeps attachment data', () => {
    const s = parseImport(legacy());
    s.conversations[0].messages[0].status = 'streaming';
    s.conversations[0].messages[0].attachments = [
      {
        id: 'a',
        name: 'a.txt',
        kind: 'text',
        mime: 'text/plain',
        size: 10000,
        data: 'a'.repeat(10000),
      },
    ];
    const parsed = parseImport(s);
    expect(parsed.conversations[0].messages[0].status).toBe('stopped');
    expect(parsed.conversations[0].messages[0].attachments[0].data).toHaveLength(10000);
  });
  it('excludes all keys from normal exports and syncs', () => {
    const s = parseImport(legacy());
    const raw = JSON.stringify(exportState(s));
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('token');
    expect(exportState(s, true).profiles[0].apiKey).toBe('secret');
    expect(exportState(s, true).settings.gistToken).toBe('');
  });
});
describe('endpoints', () => {
  it.each([
    ['https://example.com', 'https://example.com/v1/chat/completions'],
    ['example.com/v1/', 'https://example.com/v1/chat/completions'],
    ['https://example.com/gateway/v1', 'https://example.com/gateway/v1/chat/completions'],
    ['https://example.com/custom/chat/completions', 'https://example.com/custom/chat/completions'],
  ])('normalizes %s', (input, output) => expect(endpoint(input, 'chat')).toBe(output));
  it('keeps custom endpoints and query strings', () =>
    expect(endpoint('https://example.com/proxy/chat/completions?api-version=1', 'chat')).toContain(
      '?api-version=1',
    ));
  it('does not silently change another protocol', () =>
    expect(() => endpoint('https://example.com/v1/responses', 'chat')).toThrow());
  it.each(['ftp://example.com', 'https://user:pass@example.com', 'https://example.com/#foo'])(
    'rejects unsafe %s',
    (x) => expect(() => endpoint(x, 'chat')).toThrow(),
  );
  it('normalizes images without guessing by model name', () => {
    expect(endpoint('https://example.com/v1', 'image')).toBe(
      'https://example.com/v1/images/generations',
    );
    expect(endpoint('https://dashscope.aliyuncs.com', 'image', 'dashscope')).toContain(
      '/api/v1/services/aigc/multimodal-generation/generation',
    );
  });
});
const message = (id: string, role: Message['role'], content: string): Message => ({
  id,
  role,
  content,
  reasoning: '',
  createdAt: 0,
  status: 'complete',
  attachments: [],
  images: [],
});
describe('context assembly', () => {
  it('cuts earlier context and includes a system prompt', () => {
    const c = newConversation();
    c.prompt = 'system';
    c.messages = [
      message('1', 'user', 'old'),
      message('2', 'divider', ''),
      message('3', 'user', 'new'),
    ];
    expect(contextMessages(c)).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'new' },
    ]);
  });
  it('history 0 includes the current request, not history', () => {
    const c = newConversation();
    c.historyCount = 0;
    c.messages = [
      message('1', 'user', 'old'),
      message('2', 'assistant', 'reply'),
      message('3', 'user', 'new'),
    ];
    expect(contextMessages(c)).toEqual([{ role: 'user', content: 'new' }]);
  });
  it('keeps full text attachments and inline image data', () => {
    const c = newConversation();
    const m = message('1', 'user', 'Read');
    m.attachments = [
      {
        id: 'a',
        name: 'a.txt',
        kind: 'text',
        size: 10000,
        mime: 'text/plain',
        data: 'x'.repeat(10000),
      },
      {
        id: 'b',
        name: 'b.png',
        kind: 'image',
        size: 3,
        mime: 'image/png',
        data: 'data:image/png;base64,YQ==',
      },
    ];
    c.messages = [m];
    const text = JSON.stringify(contextMessages(c));
    expect(text).toContain('x'.repeat(10000));
    expect(text).toContain('image_url');
  });
  it('empty workspace has a versioned valid schema', () =>
    expect(parseImport(emptyState())).toEqual(emptyState()));
});
describe('SSE transport', () => {
  const encoded = new TextEncoder().encode(
    ': comment\r\nevent: token\r\ndata: 你好🌱\r\ndata: second\r\n\r\ndata: [DONE]',
  );
  it('works with every byte boundary, CRLF and an unterminated last event', async () => {
    for (let split = 1; split < encoded.length; split++) {
      const chunks = [encoded.slice(0, split), encoded.slice(split)];
      const stream = new ReadableStream({
        start(c) {
          chunks.forEach((x) => c.enqueue(x));
          c.close();
        },
      });
      const events = [];
      for await (const event of readSSE(stream)) events.push(event);
      expect(events).toEqual([
        { event: 'token', data: '你好🌱\nsecond' },
        { event: '', data: '[DONE]' },
      ]);
    }
  });
  it('works with one-byte chunks including UTF-8', async () => {
    const stream = new ReadableStream({
      start(c) {
        for (const byte of encoded) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    });
    const events = [];
    for await (const e of readSSE(stream)) events.push(e);
    expect(events[0].data).toBe('你好🌱\nsecond');
  });
});
