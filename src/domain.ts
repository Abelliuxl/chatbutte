import { z } from 'zod';

export const uid = () => crypto.randomUUID();
const text = z.string().max(2_000_000);
export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string().max(512),
  mime: z.string(),
  size: z.number().nonnegative(),
  kind: z.enum(['image', 'text', 'unavailable']),
  data: z.string().max(12_000_000).optional(),
  note: z.string().optional(),
});
export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  type: z.enum(['chat', 'image']),
  apiUrl: z.string().max(2048),
  apiKey: z.string().max(4096).default(''),
  model: z.string().max(200),
  reasoning: z.enum(['default', 'on', 'off']).default('default'),
  sendTemperature: z.boolean().default(true),
  thinkingFormat: z
    .enum(['enable_thinking', 'thinking', 'reasoning_effort'])
    .default('enable_thinking'),
  imageFormat: z.enum(['openai', 'dashscope']).default('openai'),
});
export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'divider']),
  content: text,
  reasoning: text.default(''),
  createdAt: z.number(),
  status: z.enum(['complete', 'streaming', 'stopped', 'error']).default('complete'),
  error: z.string().optional(),
  model: z.string().optional(),
  attachments: z.array(AttachmentSchema).max(10).default([]),
  images: z
    .array(z.object({ url: z.string().max(32_000_000), revisedPrompt: z.string().optional() }))
    .max(10)
    .default([]),
});
export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().max(500),
  prompt: z.string().max(100000),
  historyCount: z.number().int().min(0).max(200),
  temperature: z.number().min(0).max(2),
  profileId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  pinned: z.boolean().default(false),
  draft: z.string().max(100000).default(''),
  draftAttachments: z.array(AttachmentSchema).max(10).default([]),
  messages: z.array(MessageSchema).max(100000),
});
export const StateSchema = z.object({
  version: z.literal(2),
  profiles: z.array(ProfileSchema).max(500),
  conversations: z.array(ConversationSchema).max(10000),
  activeId: z.string(),
  activeProfileId: z.string(),
  settings: z.object({
    theme: z.enum(['system', 'light', 'dark']),
    language: z.enum(['zh', 'en']),
    sendKey: z.enum(['enter', 'mod', 'ctrl', 'alt']),
    gistId: z.string().max(200).default(''),
    gistToken: z.string().max(4096).default(''),
    gistRevision: z.string().default(''),
  }),
});
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type State = z.infer<typeof StateSchema>;
export const emptyState = (): State => ({
  version: 2,
  profiles: [],
  conversations: [],
  activeId: '',
  activeProfileId: '',
  settings: {
    theme: 'system',
    language: 'zh',
    sendKey: 'enter',
    gistId: '',
    gistToken: '',
    gistRevision: '',
  },
});
export function newConversation(profileId = ''): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: '',
    prompt: '',
    historyCount: 24,
    temperature: 0.7,
    profileId,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    draft: '',
    draftAttachments: [],
    messages: [],
  };
}
export function exportState(state: State, includeSecrets = false): State {
  return {
    ...state,
    profiles: state.profiles.map((p) => ({ ...p, apiKey: includeSecrets ? p.apiKey : '' })),
    settings: { ...state.settings, gistToken: '', gistRevision: '' },
  };
}

export function endpoint(input: string, type: 'chat' | 'image', format = 'openai'): string {
  const u = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.hash)
    throw new Error('Invalid API URL');
  let p = u.pathname.replace(/\/+$/, '');
  if (type === 'image' && format === 'dashscope') {
    if (/\/(chat\/completions|images\/generations)$/.test(p))
      throw new Error('Enter a DashScope multimodal endpoint / 请填写 DashScope 多模态图片端点');
    if (!p || p === '/') u.pathname = '/api/v1/services/aigc/multimodal-generation/generation';
  } else {
    if (type === 'image' && /\/chat\/completions$/.test(p))
      p = p.replace(/\/chat\/completions$/, '/images/generations');
    if (type === 'chat' && /\/images\/generations$/.test(p))
      p = p.replace(/\/images\/generations$/, '/chat/completions');
    if (/\/multimodal-generation\/generation$/.test(p))
      throw new Error(
        'Select DashScope image protocol for this endpoint / 此端点需要选择 DashScope 图片协议',
      );
    u.pathname = p || '/';
    if (!/(?:\/chat\/completions|\/images\/generations)$/.test(p)) {
      if (/\/(responses|messages)$/.test(p))
        throw new Error(
          'Use an OpenAI-compatible Chat Completions endpoint, not Responses / Messages.',
        );
      u.pathname = `${p === '/' ? '' : p}${/\/v\d+(?:beta)?$/.test(p) ? '' : '/v1'}/${type === 'chat' ? 'chat/completions' : 'images/generations'}`;
    }
  }
  return u.toString();
}
export function contextMessages(c: Conversation, beforeId?: string) {
  let messages = beforeId
    ? c.messages.slice(
        0,
        c.messages.findIndex((m) => m.id === beforeId),
      )
    : c.messages;
  const cut = messages.map((m) => m.role).lastIndexOf('divider');
  messages = messages
    .slice(cut + 1)
    .filter(
      (m) => m.role !== 'divider' && m.status !== 'error' && (m.content || m.attachments.length),
    );
  const last = messages.at(-1);
  const past = messages.slice(0, -1);
  const selected = [
    ...(c.historyCount ? past.slice(-c.historyCount) : []),
    ...(last ? [last] : []),
  ];
  while (selected.length && selected[0].role !== 'user') selected.shift();
  return [
    ...(c.prompt ? [{ role: 'system', content: c.prompt }] : []),
    ...selected.map((m) => {
      let body = m.content;
      for (const a of m.attachments.filter((a) => a.kind !== 'image'))
        body += `\n\n[${a.name}]\n${a.kind === 'text' ? a.data || '' : a.note || 'Attachment unavailable'}`;
      const images = m.attachments.filter((a) => a.kind === 'image' && a.data);
      return {
        role: m.role,
        content: images.length
          ? [
              { type: 'text', text: body },
              ...images.map((a) => ({ type: 'image_url', image_url: { url: a.data } })),
            ]
          : body,
      };
    }),
  ];
}
