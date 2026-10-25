import {
  StateSchema,
  emptyState,
  type State,
  type Profile,
  type Attachment,
  type Message,
  uid,
} from './domain';

// The only legacy boundary. Old UI/state code is deliberately not reused.
type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {};
const str = (x: unknown, fallback = '') => (typeof x === 'string' ? x : fallback);
const num = (x: unknown, fallback: number) =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export function parseImport(input: unknown, language: 'zh' | 'en' = 'zh'): State {
  const raw = obj(input);
  if (raw.version === 2) return validateReferences(StateSchema.parse(raw));
  if (
    !Array.isArray(raw.profiles) ||
    !Array.isArray(raw.topics) ||
    !raw.messagesByTopic ||
    typeof raw.messagesByTopic !== 'object' ||
    Array.isArray(raw.messagesByTopic)
  )
    throw new Error('Not a Chatbutte backup / 不是有效的 Chatbutte 备份');
  const s = emptyState();
  s.settings.language = language;
  const prefs = obj(raw.settings);
  if (['system', 'light', 'dark'].includes(str(prefs.theme)))
    s.settings.theme = prefs.theme as State['settings']['theme'];
  const key = str(prefs.sendKey);
  s.settings.sendKey =
    key === 'cmd'
      ? 'mod'
      : ['enter', 'ctrl', 'alt'].includes(key)
        ? (key as State['settings']['sendKey'])
        : 'enter';
  s.settings.gistId = str(raw.gistId);
  s.settings.gistToken = str(raw.gistToken);
  s.profiles = arr(raw.profiles).flatMap((x, i): Profile[] => {
    const p = obj(x);
    const id = str(p.id, `legacy-profile-${i}`);
    const type = p.type === 'image' || (!p.apiUrl && p.imageApiUrl) ? 'image' : 'chat';
    const make = (t: 'chat' | 'image', suffix = ''): Profile => ({
      id: id + suffix,
      name: str(p.name, str(p.model, t)),
      type: t,
      apiUrl: str(t === 'image' ? p.imageApiUrl || p.apiUrl : p.apiUrl),
      apiKey: str(p.apiKey),
      model: str(t === 'image' ? p.imageModel || p.model : p.model),
      reasoning: ['on', 'off'].includes(str(p.reasoningMode))
        ? (p.reasoningMode as 'on' | 'off')
        : 'default',
      sendTemperature: true,
      thinkingFormat: 'enable_thinking',
      imageFormat: /dashscope/.test(str(p.imageApiUrl || p.apiUrl)) ? 'dashscope' : 'openai',
    });
    const result = [make(type)];
    // Split only explicit old dual-purpose profiles, never invent unsupported image models.
    if (type === 'chat' && p.type !== 'chat' && p.imageApiUrl && p.imageModel)
      result.push(make('image', '-image'));
    return result;
  });
  const messages = obj(raw.messagesByTopic);
  for (const value of Object.values(messages))
    if (!Array.isArray(value))
      throw new Error('Legacy message history is damaged / 旧版消息历史格式损坏，未导入');
  const topics = arr(raw.topics).map(obj);
  for (const id of Object.keys(messages))
    if (!topics.some((t) => t.id === id)) topics.push({ id, name: `Recovered / 已恢复 ${id}` });
  s.conversations = topics.map((t, i) => {
    const id = str(t.id, `legacy-topic-${i}`);
    return {
      id,
      title: str(t.name),
      prompt: str(t.prompt),
      historyCount: Math.max(0, Math.min(200, num(t.historyCount, 12))),
      temperature: Math.max(0, Math.min(2, num(t.temperature, 0.7))),
      profileId: str(t.activeProfileId),
      createdAt: Date.now(),
      updatedAt: Date.now() - i,
      pinned: false,
      draft: '',
      draftAttachments: [],
      messages: arr(messages[id]).map((item): Message => {
        const m = obj(item);
        return {
          id: str(m.id, uid()),
          role: m.role === 'context_cutoff' ? 'divider' : m.role === 'user' ? 'user' : 'assistant',
          content: str(m.content),
          reasoning: str(m.reasoning),
          createdAt: num(m.time, Date.now()),
          status: m.role === 'error' ? 'error' : 'complete',
          ...(m.role === 'error' ? { error: str(m.content) } : {}),
          attachments: arr(m.attachments).map((item): Attachment => {
            const a = obj(item);
            const image = a.kind === 'image' && !!a.dataUrl;
            const text = a.kind === 'text' && typeof a.textContent === 'string';
            return {
              id: str(a.id, uid()),
              name: str(a.name, 'Attachment'),
              mime: str(a.type),
              size: num(a.size, 0),
              kind: image ? 'image' : text ? 'text' : 'unavailable',
              data: image ? str(a.dataUrl) : text ? str(a.textContent) : undefined,
              note: image
                ? undefined
                : text && a.truncated
                  ? 'Legacy text was truncated / 旧版文本已被截断'
                  : !text
                    ? 'Legacy attachment content was not saved / 旧版未保存此附件内容'
                    : undefined,
            };
          }),
          images: arr(m.generatedImages)
            .map((item) => {
              const image = obj(item);
              return { url: str(image.url), revisedPrompt: str(image.revisedPrompt) };
            })
            .filter((x) => /^(https?:|data:image\/(png|jpeg|webp);base64,)/.test(x.url)),
        };
      }),
    };
  });
  s.activeId = str(raw.activeTopicId);
  s.activeProfileId = str(raw.activeProfileId);
  return validateReferences(StateSchema.parse(s));
}
export function validateReferences(state: State): State {
  for (const items of [state.profiles, state.conversations]) {
    const ids = new Set<string>();
    for (const item of items) {
      if (!item.id || ids.has(item.id))
        throw new Error('Duplicate or empty IDs in backup / 备份含重复或空 ID');
      ids.add(item.id);
    }
  }
  for (const c of state.conversations) {
    const ids = new Set<string>();
    for (const m of c.messages) {
      if (!m.id || ids.has(m.id)) throw new Error('Duplicate message IDs');
      ids.add(m.id);
      if (m.status === 'streaming') {
        m.status = 'stopped';
        m.error = 'Interrupted by reload / 刷新中断了生成';
      }
    }
    if (!state.profiles.some((p) => p.id === c.profileId))
      c.profileId = state.profiles[0]?.id || '';
  }
  if (!state.conversations.some((c) => c.id === state.activeId))
    state.activeId = state.conversations[0]?.id || '';
  if (!state.profiles.some((p) => p.id === state.activeProfileId))
    state.activeProfileId = state.profiles[0]?.id || '';
  return state;
}
