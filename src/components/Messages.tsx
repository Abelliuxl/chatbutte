import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  isValidElement,
  memo,
  useLayoutEffect,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  ArrowDown,
  RotateCcw,
  Pencil,
  ChevronDown,
  AlertCircle,
  Download,
  ExternalLink,
  X,
  Check,
  FileText,
  Sparkles,
} from 'lucide-react';
import { type Conversation, type Message } from '../domain';
import { editConversation, notify, useWritable, getState } from '../store';
import { retryConversation } from '../api';
import { CopyButton, IconButton, Modal, useT } from '../ui';
function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <div className="code-block">
              <div className="code-toolbar">
                <span>
                  {isValidElement<{ className?: string }>(children)
                    ? children.props.className
                        ?.replace('hljs', '')
                        .replace('language-', '')
                        .trim() || 'code'
                    : 'code'}
                </span>
                <CopyButton text={nodeText(children)} />
              </div>
              <pre>{children}</pre>
            </div>
          ),
          img: ({ src, alt }) => (
            <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
export const MessageList = memo(
  function MessageList({ conversation }: { conversation: Conversation }) {
    const t = useT();
    const ref = useRef<HTMLDivElement>(null);
    const bottom = useRef<HTMLDivElement>(null);
    const following = useRef(true);
    const [atBottom, setAtBottom] = useState(true);
    const [limit, setLimit] = useState(80);
    const previousHeight = useRef<number | null>(null);
    const writable = useWritable();
    const busy = conversation.messages.some((m) => m.status === 'streaming');
    useEffect(() => {
      setLimit(80);
      following.current = true;
      setAtBottom(true);
      ref.current?.scrollTo({ top: ref.current.scrollHeight });
    }, [conversation.id]);
    useLayoutEffect(() => {
      if (previousHeight.current !== null && ref.current) {
        ref.current.scrollTop += ref.current.scrollHeight - previousHeight.current;
        previousHeight.current = null;
      }
    }, [limit]);
    const last = conversation.messages.at(-1);
    useEffect(() => {
      if (following.current) ref.current?.scrollTo({ top: ref.current.scrollHeight });
    }, [
      last?.content,
      last?.reasoning,
      last?.status,
      last?.images.length,
      conversation.messages.length,
    ]);
    useEffect(() => {
      const el = ref.current!;
      const observer = new ResizeObserver(() => {
        if (following.current) el.scrollTop = el.scrollHeight;
      });
      if (el.firstElementChild) observer.observe(el.firstElementChild);
      return () => observer.disconnect();
    }, [conversation.id]);
    return (
      <div className="messages-shell">
        <div
          className="messages-scroll"
          ref={ref}
          tabIndex={0}
          aria-label={t('会话消息', 'Conversation messages')}
          onScroll={() => {
            const el = ref.current!;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            following.current = near;
            setAtBottom(near);
          }}
        >
          <div className="message-column">
            {conversation.messages.length > limit && (
              <button
                className="button ghost load-earlier"
                onClick={() => {
                  following.current = false;
                  previousHeight.current = ref.current!.scrollHeight;
                  setLimit((x) => x + 80);
                }}
              >
                {t('加载更早的消息', 'Load earlier messages')} (
                {conversation.messages.length - limit})
              </button>
            )}
            {conversation.messages.slice(-limit).map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                conversation={conversation}
                busy={busy}
                writable={writable}
              />
            ))}
            <div ref={bottom} className="message-bottom" />
          </div>
        </div>
        {!atBottom && (
          <button
            className="jump-latest button secondary"
            onClick={() => {
              following.current = true;
              setAtBottom(true);
              ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
            }}
          >
            <ArrowDown size={16} />
            {t('回到最新', 'Jump to latest')}
          </button>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.conversation.id === next.conversation.id &&
    prev.conversation.messages === next.conversation.messages,
);
const MessageItem = memo(
  function MessageItem({
    message: m,
    conversation: c,
    busy,
    writable,
  }: {
    message: Message;
    conversation: Conversation;
    busy: boolean;
    writable: boolean;
  }) {
    const t = useT();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(m.content);
    const [preview, setPreview] = useState<string | null>(null);
    if (m.role === 'divider')
      return (
        <div className="context-divider">
          <span>
            {t(
              '新上下文从这里开始 · 上方消息不再发送',
              'New context starts here · Earlier messages are not sent',
            )}
          </span>
        </div>
      );
    const retry = () => {
      const index = c.messages.findIndex((x) => x.id === m.id);
      if (
        index < c.messages.length - 1 &&
        !confirm(
          t(
            '重新生成会移除此回复之后的消息，继续？',
            'Regenerating removes messages after this reply. Continue?',
          ),
        )
      )
        return;
      void retryConversation(c.id, m.id);
    };
    function saveEdit() {
      if (!draft.trim() && !m.attachments.length) return;
      const current = getState().conversations.find((x) => x.id === c.id);
      const hasDraft = !!current?.draft.trim() || !!current?.draftAttachments.length;
      if (
        !confirm(
          hasDraft
            ? t(
                '这将替换输入框中的现有草稿和附件，并移除此消息之后的回复。继续？',
                'This replaces your current draft and attachments and removes later replies. Continue?',
              )
            : t(
                '保存修改会移除此消息之后的所有回复。继续？',
                'Saving this edit removes all messages after it. Continue?',
              ),
        )
      )
        return;
      editConversation(c.id, (value) => ({
        ...value,
        draft,
        draftAttachments: m.attachments,
        messages: value.messages.slice(
          0,
          value.messages.findIndex((x) => x.id === m.id),
        ),
      }));
      setEditing(false);
      notify(
        t(
          '内容已放回输入框，检查后重新发送',
          'Message returned to composer. Review it and send again.',
        ),
      );
    }
    return (
      <article className={`message message-${m.role}`} data-message-id={m.id}>
        <div className="message-avatar" aria-hidden="true">
          {m.role === 'assistant' ? <Sparkles size={17} /> : <span>U</span>}
        </div>
        <div className="message-body">
          <div className="message-meta">
            <strong>{m.role === 'user' ? t('你', 'You') : m.model || 'Chatbutte'}</strong>
            <time dateTime={new Date(m.createdAt).toISOString()}>
              {new Date(m.createdAt).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
            {m.status === 'streaming' && (
              <span className="generating-label">{t('生成中', 'Generating')}</span>
            )}
          </div>
          {m.reasoning && (
            <details className="reasoning">
              <summary>
                <ChevronDown size={15} />
                {m.status === 'streaming' ? t('正在思考', 'Thinking') : t('思考过程', 'Reasoning')}
              </summary>
              <div>{m.reasoning}</div>
            </details>
          )}
          {editing ? (
            <div className="message-edit">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={t('编辑消息', 'Edit message')}
              />
              <div className="button-row">
                <button className="button secondary compact" onClick={() => setEditing(false)}>
                  <X size={14} />
                  {t('取消', 'Cancel')}
                </button>
                <button className="button primary compact" onClick={saveEdit}>
                  <Check size={14} />
                  {t('返回输入框', 'Return to composer')}
                </button>
              </div>
            </div>
          ) : m.content ? (
            <Markdown content={m.content} />
          ) : m.status === 'streaming' ? (
            <div
              className="typing-dots"
              role="status"
              aria-label={t('等待模型响应', 'Waiting for model')}
            >
              <i />
              <i />
              <i />
            </div>
          ) : null}
          {!!m.attachments.length && (
            <div className="message-attachments">
              {m.attachments.map((a) => (
                <div
                  key={a.id}
                  className={a.kind === 'image' ? 'attachment-image' : 'attachment-file'}
                >
                  {a.kind === 'image' && a.data ? (
                    <button
                      onClick={() => setPreview(a.data!)}
                      aria-label={t('预览图片', 'Preview image')}
                    >
                      <img src={a.data} alt={a.name} />
                    </button>
                  ) : (
                    <>
                      <FileText size={18} />
                      <div>
                        <strong>{a.name}</strong>
                        <span>
                          {a.kind === 'unavailable'
                            ? t('原内容不可用', 'Original content unavailable')
                            : `${Math.ceil(a.size / 1024)} KB`}
                        </span>
                      </div>
                      {a.kind === 'text' && a.data && <CopyButton text={a.data} />}
                    </>
                  )}
                  {a.note && <span className="attachment-note">{a.note}</span>}
                </div>
              ))}
            </div>
          )}
          {!!m.images.length && (
            <div className="generated-images">
              {m.images.map((image, i) => (
                <figure key={i}>
                  <button
                    onClick={() => setPreview(image.url)}
                    aria-label={t('查看生成图片', 'View generated image')}
                  >
                    <img
                      src={image.url}
                      alt={image.revisedPrompt || t('生成的图片', 'Generated image')}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                  {image.revisedPrompt && <figcaption>{image.revisedPrompt}</figcaption>}
                </figure>
              ))}
            </div>
          )}
          {m.error && (
            <div className="message-error" role="alert">
              <AlertCircle size={16} />
              <span>{m.error}</span>
            </div>
          )}
          {m.status === 'stopped' && (
            <p className="stopped-label">
              {t('已停止 · 已保留生成内容', 'Stopped · Partial response kept')}
            </p>
          )}
          <div className="message-actions">
            <CopyButton text={m.content} label={t('复制消息', 'Copy message')} />
            {m.role === 'user' ? (
              <IconButton
                label={t('编辑并重新发送', 'Edit and resend')}
                disabled={busy || !writable}
                onClick={() => {
                  setDraft(m.content);
                  setEditing(!editing);
                }}
              >
                <Pencil size={15} />
              </IconButton>
            ) : (
              <IconButton
                label={t('重新生成', 'Regenerate')}
                disabled={busy || !writable}
                onClick={retry}
              >
                <RotateCcw size={15} />
              </IconButton>
            )}
          </div>
        </div>
        {preview && (
          <Modal title={t('图片预览', 'Image preview')} onClose={() => setPreview(null)} wide>
            <div className="image-viewer">
              <img src={preview} alt={t('预览', 'Preview')} referrerPolicy="no-referrer" />
              <div className="button-row">
                <a
                  className="button secondary"
                  href={preview}
                  download="chatbutte-image.png"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={17} />
                  {t('保存图片', 'Save image')}
                </a>
                <a className="button ghost" href={preview} target="_blank" rel="noreferrer">
                  <ExternalLink size={17} />
                  {t('打开原图', 'Open original')}
                </a>
              </div>
              <small>
                {t(
                  '远程图片可能需要在新标签页中长按或右键保存。',
                  'For remote images, save with long-press or right-click in a new tab.',
                )}
              </small>
            </div>
          </Modal>
        )}
      </article>
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.conversation.id === next.conversation.id &&
    prev.conversation.messages.length === next.conversation.messages.length &&
    prev.busy === next.busy &&
    prev.writable === next.writable,
);
