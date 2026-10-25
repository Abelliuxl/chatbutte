import { readSSE } from '../shared/sse.mjs';
import {
  contextMessages,
  endpoint,
  uid,
  type Message,
  type Profile,
  type Conversation,
  type Attachment,
} from './domain';
import { getState, editConversation, notify, requireWritable, flush } from './store';
import { beginRun, workspaceOperation } from './operations';
const runs = new Map<string, AbortController>();
export const isRunning = (id: string) => runs.has(id);
export const stopRun = (id: string) => runs.get(id)?.abort();
export const anyRunning = () => runs.size > 0;
export async function apiPost(path: string, value: unknown, signal?: AbortSignal) {
  const response = await fetch(new URL(`api/${path}`, document.baseURI), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    signal,
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}
export function splitReasoning(content: string, reasoning: string) {
  if (reasoning) return { content, reasoning };
  const opening = content.indexOf('<think>');
  if (opening < 0) return { content, reasoning: '' };
  const end = content.indexOf('</think>', opening);
  return {
    reasoning: content.slice(opening + 7, end < 0 ? undefined : end),
    content: content.slice(0, opening) + (end < 0 ? '' : content.slice(end + 8)),
  };
}
export async function generate(conversation: Conversation, profile: Profile, assistantId?: string) {
  if (runs.has(conversation.id)) return;
  let release: () => void;
  try {
    requireWritable();
    release = beginRun(conversation.id);
  } catch (e) {
    notify((e as Error).message);
    return;
  }
  const controller = new AbortController();
  runs.set(conversation.id, controller);
  const messageId = assistantId || uid();
  let content = '',
    reasoning = '',
    completed = false,
    lastPaint = 0;
  const initial: Message = {
    id: messageId,
    role: 'assistant',
    content: '',
    reasoning: '',
    createdAt: Date.now(),
    status: 'streaming',
    model: profile.name || profile.model,
    attachments: [],
    images: [],
  };
  editConversation(conversation.id, (c) => ({
    ...c,
    messages: [...c.messages.filter((m) => m.id !== messageId), initial],
  }));
  const patch = (value: Partial<Message>) =>
    editConversation(conversation.id, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...value } : m)),
    }));
  try {
    await flush(); // Persist the user message before making a potentially billable request.
    const p = { ...profile, apiUrl: endpoint(profile.apiUrl, profile.type, profile.imageFormat) };
    if (profile.type === 'image') {
      const last = conversation.messages.filter((m) => m.role === 'user').at(-1);
      if (last?.attachments.some((a) => a.kind === 'image'))
        throw new Error(
          'Image generation accepts text only; reference-image editing is not supported / 当前生图仅支持文字，不支持参考图编辑',
        );
      const prompt = [
        conversation.prompt,
        last?.content,
        ...(last?.attachments.filter((a) => a.kind === 'text').map((a) => a.data) || []),
      ]
        .filter(Boolean)
        .join('\n\n');
      const response = await apiPost('images', { profile: p, prompt }, controller.signal);
      const result = await response.json();
      patch({ images: result.images, status: 'complete' });
      completed = true;
    } else {
      const response = await apiPost(
        'chat',
        {
          profile: p,
          messages: contextMessages(conversation),
          temperature: conversation.temperature,
        },
        controller.signal,
      );
      for await (const event of readSSE(response.body!)) {
        const item = JSON.parse(event.data);
        if (item.type === 'error') throw new Error(item.message);
        if (item.type === 'delta') {
          const nextContent = content + (item.content || '');
          const nextReasoning = reasoning + (item.reasoning || '');
          if (nextContent.length > 2_000_000 || nextReasoning.length > 2_000_000)
            throw new Error('Generated output exceeds limit / 生成内容超出上限');
          content = nextContent;
          reasoning = nextReasoning;
          if (performance.now() - lastPaint > 40) {
            patch(splitReasoning(content, reasoning));
            lastPaint = performance.now();
          }
        }
        if (item.type === 'done') {
          completed = true;
          if (!content && !reasoning)
            throw new Error('The model returned an empty reply / 模型返回了空回复');
          if (item.reason === 'length')
            patch({ error: 'Output limit reached / 已达到输出长度上限' });
          break;
        }
      }
      if (!completed)
        throw new Error('Connection interrupted; partial answer kept / 连接中断，已保留部分回答');
      patch({ ...splitReasoning(content, reasoning), status: 'complete' });
    }
  } catch (e) {
    patch({
      ...splitReasoning(content, reasoning),
      status: controller.signal.aborted ? 'stopped' : 'error',
      ...(controller.signal.aborted ? {} : { error: (e as Error).message }),
    });
  } finally {
    try {
      await flush();
    } catch {}
    runs.delete(conversation.id);
    release();
    editConversation(conversation.id, (c) => ({ ...c, updatedAt: Date.now() }));
  }
}
export async function sendConversation(id: string) {
  try {
    requireWritable();
    if (workspaceOperation()) throw new Error('Backup operation in progress / 备份操作进行中');
  } catch (e) {
    notify((e as Error).message);
    return;
  }
  const s = getState(),
    c = s.conversations.find((c) => c.id === id);
  if (!c || (!c.draft.trim() && !c.draftAttachments.length) || runs.has(id)) return;
  const p = s.profiles.find((p) => p.id === (c.profileId || s.activeProfileId));
  if (!p || !p.apiUrl || !p.model) {
    notify('Configure a model first / 请先配置一个模型');
    return;
  }
  if (p.type === 'image' && c.draftAttachments.some((a) => a.kind === 'image')) {
    notify('Text-to-image does not read reference images / 当前生图不支持参考图，请移除图片附件');
    return;
  }
  const message: Message = {
    id: uid(),
    role: 'user',
    content: c.draft.trim(),
    reasoning: '',
    createdAt: Date.now(),
    status: 'complete',
    attachments: c.draftAttachments,
    images: [],
  };
  const next = {
    ...c,
    draft: '',
    draftAttachments: [],
    title: c.title || (message.content || message.attachments[0]?.name || '').slice(0, 50),
    updatedAt: Date.now(),
    messages: [...c.messages, message],
  };
  editConversation(id, () => next);
  await generate(next, p);
}
export async function retryConversation(id: string, messageId: string) {
  try {
    requireWritable();
    if (workspaceOperation()) throw new Error('Backup operation in progress / 备份操作进行中');
  } catch (e) {
    notify((e as Error).message);
    return;
  }
  const s = getState(),
    c = s.conversations.find((c) => c.id === id);
  if (!c || runs.has(id)) return;
  const index = c.messages.findIndex((m) => m.id === messageId);
  if (index < 0) return;
  const p = s.profiles.find((p) => p.id === (c.profileId || s.activeProfileId));
  if (!p) {
    notify('Configure a model first / 请先配置模型');
    return;
  }
  const next = { ...c, messages: c.messages.slice(0, index) };
  editConversation(id, () => next);
  await generate(next, p);
}
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|js|jsx|ts|tsx|py|css|html|xml|yaml|yml|toml|ini|log|sh|sql|rs|go|java|c|cpp|h|rb|swift|vue)$/i;
export async function readAttachments(files: FileList | File[]): Promise<Attachment[]> {
  if (files.length > 5) throw new Error('Up to 5 attachments / 最多 5 个附件');
  return Promise.all(
    Array.from(files).map(async (file) => {
      const image = /^image\/(png|jpeg|webp|gif)$/.test(file.type);
      const text = file.type.startsWith('text/') || TEXT_EXT.test(file.name);
      if (!image && !text)
        throw new Error(
          `${file.name}: unsupported type. Attach images or text; PDFs are not parsed / 仅支持图片或文本，暂不解析 PDF`,
        );
      if (file.size > (image ? 4 * 1024 * 1024 : 512 * 1024))
        throw new Error(`${file.name}: ${image ? '4 MB' : '512 KB'} maximum / 超出大小限制`);
      const data = image
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          })
        : await file.text();
      return {
        id: uid(),
        name: file.name,
        mime: file.type || 'text/plain',
        size: file.size,
        kind: image ? 'image' : 'text',
        data,
      };
    }),
  );
}
