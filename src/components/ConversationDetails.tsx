import { useState, type FormEvent } from 'react';
import { Pin, Trash2, Eraser, Scissors, ArrowUp, ArrowDown } from 'lucide-react';
import { type Conversation, uid } from '../domain';
import { editConversation, update, notify } from '../store';
import { isRunning } from '../api';
import { Modal, useT } from '../ui';
export function ConversationDetails({
  conversation: c,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(c.title);
  const [prompt, setPrompt] = useState(c.prompt);
  const [history, setHistory] = useState(c.historyCount);
  const [temp, setTemp] = useState(c.temperature);
  const locked = () => {
    if (isRunning(c.id)) {
      notify(t('请先停止此会话的生成', 'Stop this conversation’s generation first'));
      return true;
    }
    return false;
  };
  function save(e: FormEvent) {
    e.preventDefault();
    editConversation(c.id, (value) => ({
      ...value,
      title: title.trim(),
      prompt,
      historyCount: history,
      temperature: temp,
    }));
    onClose();
  }
  function move(direction: number) {
    update((s) => {
      const conversations = [...s.conversations];
      const from = conversations.findIndex((x) => x.id === c.id);
      const to = Math.max(0, Math.min(conversations.length - 1, from + direction));
      [conversations[from], conversations[to]] = [conversations[to], conversations[from]];
      return { ...s, conversations };
    });
  }
  return (
    <Modal title={t('会话设置', 'Conversation settings')} onClose={onClose}>
      <form onSubmit={save} className="detail-form">
        <label>
          {t('会话名称', 'Conversation title')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('新对话', 'New conversation')}
            maxLength={500}
          />
        </label>
        <label>
          {t('系统提示词', 'System prompt')}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            maxLength={100000}
            placeholder={t(
              '希望 AI 扮演什么角色，遵循什么规则？',
              'What role should the AI take? What should it keep in mind?',
            )}
          />
        </label>
        <div className="form-grid">
          <label>
            {t('历史消息条数', 'History messages')}
            <input
              aria-label={t('历史消息条数', 'History messages')}
              type="number"
              min={0}
              max={200}
              value={history}
              onChange={(e) => setHistory(Number(e.target.value))}
            />
            <small>
              {t(
                '不含当前消息；0 为不带历史。',
                'Excludes the current message; 0 sends no history.',
              )}
            </small>
          </label>
          <label>
            {t('温度', 'Temperature')}
            <input
              aria-label={t('温度', 'Temperature')}
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={temp}
              onChange={(e) => setTemp(Number(e.target.value))}
            />
            <small>
              {t('仅对支持此参数的模型有效。', 'For models that support this parameter.')}
            </small>
          </label>
        </div>
        <div className="conversation-tools">
          <button
            type="button"
            className={`button secondary ${c.pinned ? 'is-pinned' : ''}`}
            onClick={() => editConversation(c.id, (value) => ({ ...value, pinned: !value.pinned }))}
          >
            <Pin size={16} />
            {c.pinned ? t('取消置顶', 'Unpin') : t('置顶会话', 'Pin')}
          </button>
          <button className="button ghost" type="button" onClick={() => move(-1)}>
            <ArrowUp size={16} />
            {t('上移', 'Move up')}
          </button>
          <button className="button ghost" type="button" onClick={() => move(1)}>
            <ArrowDown size={16} />
            {t('下移', 'Move down')}
          </button>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="detail-action"
            onClick={() => {
              if (locked() || !c.messages.length) return;
              editConversation(c.id, (value) => ({
                ...value,
                messages: [
                  ...value.messages,
                  {
                    id: uid(),
                    role: 'divider',
                    content: '',
                    reasoning: '',
                    createdAt: Date.now(),
                    status: 'complete',
                    attachments: [],
                    images: [],
                  },
                ],
              }));
              onClose();
            }}
          >
            <Scissors size={17} />
            <span>
              <strong>{t('开始新上下文', 'Start a new context')}</strong>
              <small>
                {t(
                  '保留可见记录，后续不再发送之前的消息。',
                  'Keep visible history, but stop sending earlier messages.',
                )}
              </small>
            </span>
          </button>
          <button
            type="button"
            className="detail-action"
            onClick={() => {
              if (locked()) return;
              if (
                confirm(
                  t(
                    '清空此会话的所有消息？不可撤销。',
                    'Clear all messages in this conversation? This cannot be undone.',
                  ),
                )
              ) {
                editConversation(c.id, (value) => ({ ...value, messages: [] }));
                onClose();
              }
            }}
          >
            <Eraser size={17} />
            <span>
              <strong>{t('清空消息', 'Clear messages')}</strong>
              <small>
                {t(
                  '保留会话与设置，删除所有消息。',
                  'Keep this conversation and its settings, remove all messages.',
                )}
              </small>
            </span>
          </button>
          <button
            type="button"
            className="detail-action danger"
            onClick={() => {
              if (locked()) return;
              if (
                confirm(
                  t(
                    '删除此会话及其消息？不可撤销。',
                    'Delete this conversation and its messages? This cannot be undone.',
                  ),
                )
              ) {
                update((s) => {
                  const conversations = s.conversations.filter((x) => x.id !== c.id);
                  return {
                    ...s,
                    conversations,
                    activeId: s.activeId === c.id ? conversations[0]?.id || '' : s.activeId,
                  };
                });
                onClose();
              }
            }}
          >
            <Trash2 size={17} />
            <span>
              <strong>{t('删除会话', 'Delete conversation')}</strong>
              <small>
                {t(
                  '会话与消息一起删除，不留下孤立数据。',
                  'Remove the conversation and all of its messages.',
                )}
              </small>
            </span>
          </button>
        </div>
        <div className="form-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            {t('取消', 'Cancel')}
          </button>
          <button type="submit" className="button primary">
            {t('保存设置', 'Save settings')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
