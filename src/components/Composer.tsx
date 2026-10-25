import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowUp,
  Square,
  Paperclip,
  X,
  FileText,
  ChevronDown,
  Image,
  Sparkles,
  Settings2,
} from 'lucide-react';
import { type Conversation, type Attachment } from '../domain';
import { useStore, update, editConversation, notify } from '../store';
import { readAttachments, sendConversation, stopRun, isRunning } from '../api';
import { IconButton, useT } from '../ui';
export function Composer({
  conversation: c,
  onSettings,
}: {
  conversation: Conversation;
  onSettings: () => void;
}) {
  const { state, readOnly } = useStore();
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const profile = state.profiles.find((p) => p.id === (c.profileId || state.activeProfileId));
  const busy = isRunning(c.id);
  useEffect(() => {
    const el = ref.current!;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [c.draft, c.id]);
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, [c.id]);
  async function attach(files: FileList | File[]) {
    if (loading) return;
    setLoading(true);
    try {
      if (c.draftAttachments.length + files.length > 5)
        throw new Error(t('最多 5 个附件', 'Up to 5 attachments'));
      const next = await readAttachments(files);
      editConversation(c.id, (value) => ({
        ...value,
        draftAttachments: [...value.draftAttachments, ...next].slice(0, 5),
      }));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function keydown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key !== 'Enter' || e.shiftKey) return;
    const mobile = matchMedia('(pointer: coarse)').matches;
    const key = state.settings.sendKey;
    const send =
      key === 'enter'
        ? !mobile && !e.ctrlKey && !e.metaKey && !e.altKey
        : key === 'mod'
          ? e.metaKey || e.ctrlKey
          : key === 'ctrl'
            ? e.ctrlKey
            : e.altKey;
    if (send) {
      e.preventDefault();
      if (!busy && !loading) void sendConversation(c.id);
    }
  }
  const changeModel = (id: string) => {
    editConversation(c.id, (value) => ({ ...value, profileId: id }));
    update((s) => ({ ...s, activeProfileId: id }));
  };
  return (
    <footer className="composer-area">
      <div
        className={`composer ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void attach(e.dataTransfer.files);
        }}
      >
        {!!c.draftAttachments.length && (
          <div className="draft-attachments">
            {c.draftAttachments.map((a) => (
              <DraftAttachment
                key={a.id}
                attachment={a}
                remove={() =>
                  editConversation(c.id, (value) => ({
                    ...value,
                    draftAttachments: value.draftAttachments.filter((x) => x.id !== a.id),
                  }))
                }
              />
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={c.draft}
          onChange={(e) => editConversation(c.id, (value) => ({ ...value, draft: e.target.value }))}
          onKeyDown={keydown}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              void attach(e.clipboardData.files);
            }
          }}
          placeholder={
            !profile
              ? t('先连接一个模型，让想法开始流动…', 'Connect a model to get started…')
              : profile.type === 'image'
                ? t('描述你想创造的画面…', 'Describe the image you want to create…')
                : t('有什么想法？尽管说说…', 'What’s on your mind?')
          }
          aria-label={t('消息输入框', 'Message input')}
          rows={1}
          maxLength={100000}
          disabled={readOnly}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <IconButton
              label={t('添加图片或文本文件', 'Attach images or text files')}
              disabled={loading || readOnly}
              onClick={() => input.current?.click()}
            >
              <Paperclip size={19} />
            </IconButton>
            <input
              ref={input}
              hidden
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,text/*,.json,.csv,.md,.py,.ts,.js,.yaml,.yml,.toml,.log,.sql,.rs,.go"
              onChange={(e) => {
                if (e.target.files) void attach(e.target.files);
                e.target.value = '';
              }}
            />
            {state.profiles.length ? (
              <label className="model-picker">
                {profile?.type === 'image' ? <Image size={15} /> : <Sparkles size={15} />}
                <select
                  value={profile?.id || ''}
                  onChange={(e) => changeModel(e.target.value)}
                  disabled={busy || readOnly}
                  aria-label={t('选择模型', 'Select model')}
                >
                  {state.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.model}
                      {p.type === 'image' ? t(' · 生图', ' · Image') : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
            ) : (
              <button className="connect-model" onClick={onSettings}>
                <Settings2 size={16} />
                {t('连接模型', 'Connect a model')}
              </button>
            )}
          </div>
          {busy ? (
            <button
              className="send-button stop"
              aria-label={t('停止生成', 'Stop generation')}
              title={t('停止生成', 'Stop generation')}
              onClick={() => stopRun(c.id)}
            >
              <Square size={17} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              aria-label={t('发送消息', 'Send message')}
              title={t('发送消息', 'Send message')}
              disabled={
                (!c.draft.trim() && !c.draftAttachments.length) || !profile || loading || readOnly
              }
              onClick={() => void sendConversation(c.id)}
            >
              <ArrowUp size={21} />
            </button>
          )}
        </div>
        {dragging && <div className="drop-overlay">{t('放开以添加附件', 'Drop to attach')}</div>}
      </div>
      <div className="composer-footnote">
        <span>
          {loading
            ? t('正在读取附件…', 'Reading attachments…')
            : t(
                'AI 可能会犯错，请核实重要信息。',
                'AI can make mistakes. Verify important information.',
              )}
        </span>
        <span className="desktop-shortcut">
          {state.settings.sendKey === 'enter'
            ? '↵'
            : state.settings.sendKey === 'mod'
              ? '⌘ / Ctrl ↵'
              : state.settings.sendKey === 'ctrl'
                ? 'Ctrl ↵'
                : 'Alt ↵'}{' '}
          {t('发送', 'send')}
        </span>
      </div>
    </footer>
  );
}
function DraftAttachment({
  attachment: a,
  remove,
}: {
  attachment: Attachment;
  remove: () => void;
}) {
  const t = useT();
  return (
    <div className="draft-file">
      {a.kind === 'image' ? <img src={a.data} alt="" /> : <FileText size={21} />}
      <div>
        <strong>{a.name}</strong>
        <small>{Math.ceil(a.size / 1024)} KB</small>
      </div>
      <IconButton label={t('移除附件', 'Remove attachment')} onClick={remove}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
