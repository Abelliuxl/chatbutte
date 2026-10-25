import { useEffect, useState, useRef, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  ArrowUpRight,
  Code2,
  PenLine,
  Lightbulb,
  Pin,
  X,
  LockKeyhole,
  Check,
  AlertTriangle,
  LoaderCircle,
} from 'lucide-react';
import { workspaceOperation } from './operations';
import { canWrite } from './store';
import { newConversation, type Conversation } from './domain';
import { useStore, update, editConversation, dismissNotice, downloadBackup, notify } from './store';
import { apiPost } from './api';
import { IconButton, useT } from './ui';
import { Composer } from './components/Composer';
const MessageList = lazy(() =>
  import('./components/Messages').then((module) => ({ default: module.MessageList })),
);
const SettingsModal = lazy(() =>
  import('./components/Settings').then((module) => ({ default: module.Settings })),
);
import { ConversationDetails } from './components/ConversationDetails';

export default function App() {
  const { state, ready, saving, error, notice, readOnly, recovery } = useStore();
  const t = useT();
  const [sidebar, setSidebar] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState(false);
  const [detailId, setDetailId] = useState('');
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [narrow, setNarrow] = useState(matchMedia('(max-width: 760px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia('(max-width: 760px)');
    const resize = () => {
      setNarrow(media.matches);
      if (!media.matches) setSidebar(false);
    };
    media.addEventListener('change', resize);
    const viewport = () => {
      if (!window.visualViewport || window.visualViewport.scale !== 1) return;
      document.documentElement.style.setProperty(
        '--viewport-height',
        `${window.visualViewport.height}px`,
      );
    };
    viewport();
    window.visualViewport?.addEventListener('resize', viewport);
    return () => {
      media.removeEventListener('change', resize);
      window.visualViewport?.removeEventListener('resize', viewport);
    };
  }, []);
  const c = state.conversations.find((x) => x.id === state.activeId);
  const detail = state.conversations.find((x) => x.id === detailId);
  useEffect(() => {
    void fetch(new URL('api/health', document.baseURI))
      .then((r) => r.json())
      .then((x) => setLocked(x.authRequired))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark =
        state.settings.theme === 'dark' || (state.settings.theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.lang = state.settings.language === 'zh' ? 'zh-CN' : 'en';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#17181c' : '#f7f8fa');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [state.settings.theme, state.settings.language]);
  useEffect(() => {
    if (!sidebar || !narrow) return;
    const focus = document.activeElement as HTMLElement;
    sidebarRef.current?.querySelector<HTMLButtonElement>('.mobile-only')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebar(false);
      if (e.key === 'Tab') {
        const items = Array.from(
          sidebarRef.current!.querySelectorAll<HTMLElement>('button:not([disabled]),input'),
        ).filter((el) => el.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      focus?.focus();
    };
  }, [sidebar, narrow]);
  useEffect(() => {
    if (!ready || readOnly || recovery || state.conversations.length) return;
    update((s) => {
      if (s.conversations.length) return s;
      const first = newConversation(s.activeProfileId);
      return { ...s, conversations: [first], activeId: first.id };
    });
  }, [ready, readOnly, recovery, state.conversations.length]);
  function create() {
    if (!canWrite() || workspaceOperation()) return;
    const next = newConversation(state.activeProfileId);
    update((s) => ({ ...s, conversations: [next, ...s.conversations], activeId: next.id }));
    setSidebar(false);
    setSearch('');
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        create();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const select = (id: string) => {
    update((s) => ({ ...s, activeId: id }));
    setSidebar(false);
  };
  const visible = useMemo(
    () =>
      !search.trim()
        ? state.conversations
        : state.conversations.filter(
            (x) =>
              x.title.toLowerCase().includes(search.toLowerCase()) ||
              x.messages.some((m) => m.content.toLowerCase().includes(search.toLowerCase())),
          ),
    [state.conversations, search],
  );
  if (!ready)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" size={24} />
        <p>{t('正在打开你的工作区…', 'Opening your workspace…')}</p>
      </div>
    );
  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label={t('关闭会话列表', 'Close conversation list')}
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${sidebar ? 'mobile-open' : ''}`}
        aria-label={t('会话导航', 'Conversation navigation')}
        inert={narrow ? !sidebar : collapsed}
      >
        <div className="sidebar-brand">
          <Brand />
          <IconButton
            label={t('收起会话列表', 'Collapse conversation list')}
            onClick={() => {
              setCollapsed(true);
              setSidebar(false);
            }}
            className="desktop-only"
          >
            <PanelLeftClose size={18} />
          </IconButton>
          <IconButton
            label={t('关闭会话列表', 'Close conversation list')}
            onClick={() => setSidebar(false)}
            className="mobile-only"
          >
            <X size={20} />
          </IconButton>
        </div>
        <button
          className="new-chat"
          aria-label={t('新对话', 'New conversation')}
          onClick={create}
          disabled={readOnly}
        >
          <Plus size={19} />
          <span>{t('新对话', 'New conversation')}</span>
          <kbd>⌘ ⇧ O</kbd>
        </button>
        <label className="search-field">
          <Search size={16} />
          <input
            type="search"
            aria-label={t('搜索会话', 'Search conversations')}
            placeholder={t('搜索会话…', 'Search conversations…')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="conversation-list">
          {([true, false] as const).map((pinned) => {
            const items = visible.filter((x) => x.pinned === pinned);
            if (!items.length) return null;
            return (
              <section key={String(pinned)}>
                <h2>{pinned ? t('置顶', 'Pinned') : t('最近会话', 'Recent')}</h2>
                {items.map((item) => (
                  <ConversationRow
                    key={item.id}
                    conversation={item}
                    active={c?.id === item.id}
                    onSelect={() => select(item.id)}
                    onDetails={() => {
                      setDetailId(item.id);
                      setSidebar(false);
                    }}
                  />
                ))}
              </section>
            );
          })}
          {!visible.length && (
            <p className="no-results">{t('没有找到相关会话', 'No matching conversations')}</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className="sidebar-settings"
            onClick={() => {
              setSettings(true);
              setSidebar(false);
            }}
          >
            <span className="settings-icon">
              <Settings size={18} />
            </span>
            <span>
              {t('设置与模型', 'Settings & models')}
              <small>Chatbutte 2.0</small>
            </span>
            <MoreHorizontal size={18} />
          </button>
          <div className="local-status">
            {error ? (
              <AlertTriangle size={12} />
            ) : saving ? (
              <LoaderCircle size={12} className="spin" />
            ) : (
              <Check size={12} />
            )}
            <span>
              {error
                ? t('本地保存出现问题', 'Local storage issue')
                : saving
                  ? t('正在保存…', 'Saving…')
                  : t('数据仅保存在此设备', 'Stored on this device')}
            </span>
          </div>
        </div>
      </aside>
      <main className="workspace" inert={narrow && sidebar}>
        <header className="workspace-header">
          <div className="header-start">
            <IconButton
              label={t('打开会话列表', 'Open conversation list')}
              onClick={() => {
                setCollapsed(false);
                if (narrow) setSidebar(true);
              }}
              className={collapsed ? '' : 'mobile-only'}
            >
              <PanelLeftOpen size={20} />
            </IconButton>
            <div className="header-titles">
              <span className="header-eyebrow">{t('你的灵感工作台', 'YOUR AI WORKSPACE')}</span>
              <h1>{c?.title || t('新对话', 'New conversation')}</h1>
            </div>
          </div>
          <div className="header-actions">
            <span className="privacy-pill">
              <LockKeyhole size={12} />
              {t('本地优先', 'Local first')}
            </span>
            <IconButton
              label={t('新对话', 'New conversation')}
              onClick={create}
              disabled={readOnly}
            >
              <Plus size={20} />
            </IconButton>
            {c && (
              <IconButton
                label={t('会话设置', 'Conversation settings')}
                onClick={() => setDetailId(c.id)}
              >
                <MoreHorizontal size={21} />
              </IconButton>
            )}
          </div>
        </header>
        {(error || readOnly) && (
          <div className="global-warning" role="alert">
            <AlertTriangle size={17} />
            <span>
              {readOnly
                ? t(
                    '此工作区已在另一个标签页打开。请关闭另一页后刷新，避免覆盖数据。',
                    'This workspace is open in another tab. Close it and reload to avoid overwriting data.',
                  )
                : error}
            </span>
            <button onClick={() => downloadBackup()}>{t('导出备份', 'Export backup')}</button>
          </div>
        )}
        {c ? (
          <>
            <div
              className={`conversation-content ${c.messages.length ? 'has-messages' : 'is-empty'}`}
            >
              {c.messages.length ? (
                <Suspense
                  fallback={
                    <div className="loading-screen">
                      <LoaderCircle className="spin" size={22} />
                    </div>
                  }
                >
                  <MessageList conversation={c} />
                </Suspense>
              ) : (
                <Welcome
                  hasModels={state.profiles.length > 0}
                  onSettings={() => setSettings(true)}
                  onPrompt={(value) => {
                    editConversation(c.id, (x) => ({ ...x, draft: value }));
                    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                  }}
                />
              )}
            </div>
            <Composer conversation={c} onSettings={() => setSettings(true)} />
          </>
        ) : (
          <div className="loading-screen">
            {recovery ? (
              <>
                <AlertTriangle size={28} />
                <p>
                  {t(
                    '原始数据已保留，请从备份恢复工作区。',
                    'Original data is preserved. Recover the workspace from a backup.',
                  )}
                </p>
                <button className="button primary" onClick={() => setSettings(true)}>
                  {t('打开数据恢复', 'Open data recovery')}
                </button>
              </>
            ) : (
              <button className="button primary" onClick={create}>
                {t('开始新对话', 'Start a conversation')}
              </button>
            )}
          </div>
        )}
      </main>
      {settings && (
        <Suspense fallback={null}>
          <SettingsModal
            initialTab={recovery ? 'data' : 'models'}
            onClose={() => setSettings(false)}
          />
        </Suspense>
      )}{' '}
      {detail && (
        <ConversationDetails
          key={detail.id}
          conversation={detail}
          onClose={() => setDetailId('')}
        />
      )}
      {notice &&
        createPortal(
          <div className="toast" role="status">
            <span>{notice}</span>
            <IconButton label={t('关闭提示', 'Dismiss notification')} onClick={dismissNotice}>
              <X size={16} />
            </IconButton>
          </div>,
          document.querySelector('dialog[open]') || document.body,
        )}
      {locked && (
        <div className="auth-overlay">
          <form
            className="auth-card"
            onSubmit={(e) => {
              e.preventDefault();
              setLoginBusy(true);
              void apiPost('login', { password })
                .then(() => {
                  setLocked(false);
                  setPassword('');
                  notify(t('工作区已解锁', 'Workspace unlocked'));
                })
                .catch((e) => setLoginError((e as Error).message))
                .finally(() => setLoginBusy(false));
            }}
          >
            <Brand />
            <h2>{t('欢迎回来', 'Welcome back')}</h2>
            <p>
              {t(
                '输入此部署的访问密码，继续你的对话。',
                'Enter this deployment’s password to continue.',
              )}
            </p>
            <label>
              {t('访问密码', 'Access password')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </label>
            {loginError && (
              <p className="form-error" role="alert">
                {loginError}
              </p>
            )}
            <button className="button primary" disabled={loginBusy}>
              {loginBusy ? t('正在解锁…', 'Unlocking…') : t('解锁工作区', 'Unlock workspace')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <MessageSquare size={20} strokeWidth={2.3} />
        <i />
      </span>
      <span>
        Chatbutte<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function ConversationRow({
  conversation: c,
  active,
  onSelect,
  onDetails,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onDetails: () => void;
}) {
  const t = useT();
  return (
    <div className={`conversation-row ${active ? 'active' : ''}`}>
      <button
        className="conversation-select"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
      >
        {c.pinned ? <Pin size={15} /> : <MessageSquare size={15} />}
        <span>{c.title || t('新对话', 'New conversation')}</span>
        {c.messages.some((m) => m.status === 'streaming') && <i className="run-indicator" />}
      </button>
      <IconButton label={t('管理会话', 'Manage conversation')} onClick={onDetails}>
        <MoreHorizontal size={16} />
      </IconButton>
    </div>
  );
}
function Welcome({
  hasModels,
  onSettings,
  onPrompt,
}: {
  hasModels: boolean;
  onSettings: () => void;
  onPrompt: (value: string) => void;
}) {
  const t = useT();
  const cards = [
    {
      icon: PenLine,
      title: t('写点什么', 'Find the right words'),
      desc: t('把模糊想法，变成清晰表达', 'Turn a rough idea into something clear'),
      prompt: t(
        '帮我整理一个想法。先问我几个问题，了解背景和目标。',
        'Help me develop an idea. Start by asking a few questions about the context and goal.',
      ),
    },
    {
      icon: Lightbulb,
      title: t('换个角度', 'Explore a new angle'),
      desc: t('一起拆解问题，发现新可能', 'Break down a problem. Find possibilities.'),
      prompt: t(
        '我想和你一起拆解一个问题。请先了解我的问题，再从不同角度分析。',
        'I’d like to work through a problem. Ask me about it, then help me explore different perspectives.',
      ),
    },
    {
      icon: Code2,
      title: t('一起创造', 'Build something'),
      desc: t('从一行代码，到下一个作品', 'From a line of code to your next project'),
      prompt: t(
        '我想做一个小项目。请先询问我的想法、技术背景和目标，然后帮我制定实现计划。',
        'I want to build a small project. Ask about my idea, skills and goals, then help me plan it.',
      ),
    },
  ];
  return (
    <div className="welcome-scroll">
      <div className="welcome">
        <div className="welcome-orb">
          <Sparkles size={34} strokeWidth={1.5} />
        </div>
        <p className="welcome-kicker">A LITTLE SPACE FOR BIG IDEAS</p>
        <h2>{t('让想法，继续生长。', 'A little thought.\nA world of possibility.')}</h2>
        <p className="welcome-description">
          {t(
            '聊聊问题，打磨灵感，或者一起创造点什么。',
            'Think it through. Find your words. Make something new.',
          )}
        </p>
        {!hasModels && (
          <button className="onboard-connect" onClick={onSettings}>
            <span>
              <span className="onboard-icon">
                <Plus size={19} />
              </span>
              <span>
                <strong>{t('连接你的第一个模型', 'Connect your first model')}</strong>
                <small>
                  {t(
                    '使用你自己的 API，让这里成为你的空间',
                    'Bring your own API. Make this space yours.',
                  )}
                </small>
              </span>
            </span>
            <ArrowUpRight size={20} />
          </button>
        )}
        <div className="suggestion-grid">
          {cards.map((card) => (
            <button
              className="suggestion-card"
              key={card.title}
              onClick={() => onPrompt(card.prompt)}
            >
              <card.icon size={19} />
              <strong>{card.title}</strong>
              <span>{card.desc}</span>
              <ArrowUpRight className="suggestion-arrow" size={16} />
            </button>
          ))}
        </div>
        <div className="welcome-note">
          <LockKeyhole size={12} />
          {t(
            '会话留在你的设备，灵感不设边界。',
            'Conversations on your device. Ideas without limits.',
          )}
        </div>
      </div>
    </div>
  );
}
