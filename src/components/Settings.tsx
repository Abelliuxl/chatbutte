import { useRef, useState, type FormEvent } from 'react';
import {
  Plus,
  SlidersHorizontal,
  Palette,
  Database,
  Cloud,
  Trash2,
  Upload,
  Download,
  ShieldCheck,
  Eye,
  EyeOff,
  CircleHelp,
  ExternalLink,
} from 'lucide-react';
import { type Profile, uid, endpoint, emptyState } from '../domain';
import {
  useStore,
  update,
  notify,
  downloadBackup,
  replaceState,
  restorePoint,
  flush,
  requireWritable,
} from '../store';
import { parseImport } from '../migration';
import { anyRunning } from '../api';
import { withWorkspaceOperation, workspaceOperation } from '../operations';
import { uploadGist, downloadGist } from '../sync';
import { Modal, IconButton, useT } from '../ui';

type Tab = 'models' | 'general' | 'data' | 'sync';
export function Settings({
  onClose,
  initialTab = 'models',
}: {
  onClose: () => void;
  initialTab?: Tab;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dirty, setDirty] = useState(false);
  const change = (next: Tab) => {
    if (next === tab) return;
    if (workspaceOperation()) {
      notify(t('请等待备份操作完成', 'Wait for the backup operation to finish'));
      return;
    }
    if (dirty && !confirm(t('放弃尚未保存的模型修改？', 'Discard unsaved model changes?'))) return;
    setDirty(false);
    setTab(next);
  };
  const close = () => {
    if (workspaceOperation()) {
      notify(t('请等待备份操作完成', 'Wait for the backup operation to finish'));
      return;
    }
    if (!dirty || confirm(t('放弃尚未保存的模型修改？', 'Discard unsaved model changes?')))
      onClose();
  };
  const tabs = [
    { id: 'models' as const, label: t('模型与连接', 'Models'), icon: SlidersHorizontal },
    { id: 'general' as const, label: t('通用设置', 'General'), icon: Palette },
    { id: 'data' as const, label: t('数据与备份', 'Data & backups'), icon: Database },
    { id: 'sync' as const, label: t('云端同步', 'Cloud sync'), icon: Cloud },
  ];
  return (
    <Modal title={t('设置', 'Settings')} onClose={close} wide>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('设置分类', 'Settings categories')}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'selected' : ''}
              onClick={() => change(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
          <div className="settings-version">
            Chatbutte <span>2.0</span>
            <p>{t('少一点干扰，多一点灵感。', 'Less noise. More possibility.')}</p>
          </div>
        </nav>
        <div className="settings-content">
          {tab === 'models' ? (
            <Models dirty={dirty} setDirty={setDirty} />
          ) : tab === 'general' ? (
            <General />
          ) : tab === 'data' ? (
            <Data />
          ) : (
            <Sync />
          )}
        </div>
      </div>
    </Modal>
  );
}
function Models({ dirty, setDirty }: { dirty: boolean; setDirty: (value: boolean) => void }) {
  const { state } = useStore();
  const t = useT();
  const [selected, setSelected] = useState(state.profiles[0]?.id || 'new');
  const choose = (id: string) => {
    if (id === selected) return;
    if (dirty && !confirm(t('放弃尚未保存的模型修改？', 'Discard unsaved model changes?'))) return;
    setDirty(false);
    setSelected(id);
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>{t('连接你的模型', 'Connect your models')}</h3>
          <p>
            {t(
              '自由选择服务商，在同一个空间里对话与创作。',
              'Your providers. One space for conversations and creation.',
            )}
          </p>
        </div>
        <button className="button secondary compact" onClick={() => choose('new')}>
          <Plus size={16} />
          {t('添加', 'Add')}
        </button>
      </div>
      <div className="model-tabs">
        {state.profiles.map((p) => (
          <button
            className={selected === p.id ? 'model-tab active' : 'model-tab'}
            key={p.id}
            onClick={() => choose(p.id)}
          >
            <span className={`model-dot ${p.type}`} />
            {p.name || p.model}
          </button>
        ))}
        {selected === 'new' && <span className="model-tab active">{t('新模型', 'New model')}</span>}
      </div>
      <ProfileEditor
        key={selected}
        profile={state.profiles.find((p) => p.id === selected)}
        setDirty={setDirty}
        onSaved={setSelected}
      />
    </>
  );
}
function ProfileEditor({
  profile,
  setDirty,
  onSaved,
}: {
  profile?: Profile;
  setDirty: (v: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const t = useT();
  const [p, setP] = useState<Profile>(
    profile || {
      id: uid(),
      name: '',
      type: 'chat',
      apiUrl: '',
      apiKey: '',
      model: '',
      reasoning: 'default',
      sendTemperature: true,
      thinkingFormat: 'enable_thinking',
      imageFormat: 'openai',
    },
  );
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const field = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setP({ ...p, [key]: value });
    setDirty(true);
    setError('');
  };
  function save(e: FormEvent) {
    e.preventDefault();
    try {
      requireWritable();
      if (!p.model.trim()) throw new Error(t('请填写模型 ID', 'Enter a model ID'));
      const next = {
        ...p,
        name: p.name.trim() || p.model.trim(),
        model: p.model.trim(),
        apiUrl: endpoint(p.apiUrl.trim(), p.type, p.imageFormat),
        apiKey: p.apiKey.trim(),
      };
      update((s) => ({
        ...s,
        profiles: s.profiles.some((x) => x.id === next.id)
          ? s.profiles.map((x) => (x.id === next.id ? next : x))
          : [...s.profiles, next],
        activeProfileId: s.activeProfileId || next.id,
        conversations: s.conversations.map((c) =>
          !c.profileId ? { ...c, profileId: next.id } : c,
        ),
      }));
      setP(next);
      setDirty(false);
      onSaved(next.id);
      notify(t('模型已保存', 'Model saved'));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function remove() {
    if (anyRunning()) {
      notify(t('请先停止正在进行的生成', 'Stop active generations first'));
      return;
    }
    if (
      !confirm(
        t(
          '删除此模型配置？会话记录不会删除。',
          'Delete this model configuration? Conversations will be kept.',
        ),
      )
    )
      return;
    update((s) => {
      const profiles = s.profiles.filter((x) => x.id !== p.id);
      const fallback = profiles[0]?.id || '';
      return {
        ...s,
        profiles,
        activeProfileId: s.activeProfileId === p.id ? fallback : s.activeProfileId,
        conversations: s.conversations.map((c) =>
          c.profileId === p.id ? { ...c, profileId: fallback } : c,
        ),
      };
    });
    setDirty(false);
    onSaved('new');
  }
  return (
    <form onSubmit={save} className="settings-form">
      <div className="segmented">
        <button
          type="button"
          className={p.type === 'chat' ? 'active' : ''}
          onClick={() => field('type', 'chat')}
        >
          {t('对话模型', 'Chat model')}
        </button>
        <button
          type="button"
          className={p.type === 'image' ? 'active' : ''}
          onClick={() => field('type', 'image')}
        >
          {t('图像生成', 'Image generation')}
        </button>
      </div>
      <div className="form-grid">
        <label>
          {t('显示名称', 'Display name')}
          <input
            value={p.name}
            onChange={(e) => field('name', e.target.value)}
            placeholder={t('例如：我的日常助手', 'e.g. Everyday assistant')}
            maxLength={200}
          />
        </label>
        <label>
          {t('模型 ID', 'Model ID')}
          <input
            value={p.model}
            onChange={(e) => field('model', e.target.value)}
            placeholder={p.type === 'chat' ? 'e.g. your-chat-model' : 'e.g. your-image-model'}
            required
            maxLength={200}
          />
        </label>
      </div>
      <label>
        {t('API 地址', 'API URL')}
        <input
          aria-label={t('API 地址', 'API URL')}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={p.apiUrl}
          onChange={(e) => field('apiUrl', e.target.value)}
          placeholder="https://api.example.com/v1"
          required
          maxLength={2048}
        />
        <small>
          {t(
            '可填写基础地址或完整端点。服务器仅允许公网 HTTPS 地址。',
            'A base URL or full endpoint. Public HTTPS addresses only.',
          )}
        </small>
      </label>
      <label>
        {t('API 密钥', 'API key')}
        <div className="secret-field">
          <input
            aria-label={t('API 密钥', 'API key')}
            type={show ? 'text' : 'password'}
            value={p.apiKey}
            onChange={(e) => field('apiKey', e.target.value)}
            placeholder={t('仅保存在此浏览器，可留空', 'Stored in this browser only; optional')}
            autoComplete="off"
            spellCheck={false}
          />
          <IconButton
            label={show ? t('隐藏密钥', 'Hide key') : t('显示密钥', 'Show key')}
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </IconButton>
        </div>
      </label>
      {p.type === 'image' ? (
        <label>
          {t('图片接口协议', 'Image API protocol')}
          <select
            value={p.imageFormat}
            onChange={(e) => field('imageFormat', e.target.value as Profile['imageFormat'])}
          >
            <option value="openai">OpenAI Images</option>
            <option value="dashscope">DashScope Multimodal (sync)</option>
          </select>
          <small>
            {t(
              '仅支持同步文生图，不支持异步任务与参考图编辑。',
              'Synchronous text-to-image only; no async tasks or image editing.',
            )}
          </small>
        </label>
      ) : (
        <div className="form-grid">
          <label>
            {t('思考模式', 'Reasoning')}
            <select
              value={p.reasoning}
              onChange={(e) => field('reasoning', e.target.value as Profile['reasoning'])}
            >
              <option value="default">
                {t('跟随模型（推荐）', 'Model default (recommended)')}
              </option>
              <option value="on">{t('开启', 'Enabled')}</option>
              <option value="off">{t('关闭', 'Disabled')}</option>
            </select>
          </label>
          {p.reasoning !== 'default' && (
            <label>
              {t('思考控制字段', 'Reasoning field')}
              <select
                value={p.thinkingFormat}
                onChange={(e) =>
                  field('thinkingFormat', e.target.value as Profile['thinkingFormat'])
                }
              >
                <option value="enable_thinking">enable_thinking</option>
                <option value="thinking">thinking.type</option>
                <option value="reasoning_effort">reasoning_effort</option>
              </select>
            </label>
          )}
        </div>
      )}
      {p.type === 'chat' && (
        <label className="temperature-toggle">
          <input
            type="checkbox"
            checked={p.sendTemperature}
            onChange={(e) => field('sendTemperature', e.target.checked)}
          />
          <span>
            {t(
              '发送温度参数（模型不支持时可关闭）',
              'Send temperature (disable for models that do not support it)',
            )}
          </span>
        </label>
      )}
      <div className="info-box">
        <ShieldCheck size={18} />
        <p>
          {t(
            '密钥在本机浏览器中明文保存。请求会经过部署此应用的服务器，再发送给你配置的服务商。请只使用你信任的部署。',
            'Keys are stored unencrypted in this browser. Requests pass through this deployment’s server to your provider. Use only a deployment you trust.',
          )}
        </p>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        {profile && (
          <button type="button" className="button danger ghost" onClick={remove}>
            <Trash2 size={16} />
            {t('删除模型', 'Delete model')}
          </button>
        )}
        <button className="button primary" type="submit">
          {t('保存模型', 'Save model')}
        </button>
      </div>
    </form>
  );
}
function General() {
  const { state } = useStore();
  const t = useT();
  const set = <K extends keyof typeof state.settings>(key: K, value: (typeof state.settings)[K]) =>
    update((s) => ({ ...s, settings: { ...s.settings, [key]: value } }));
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>{t('让这里更像你的空间', 'Make it feel like yours')}</h3>
          <p>{t('所有调整立即生效。', 'All changes are applied immediately.')}</p>
        </div>
      </div>
      <div className="settings-form">
        <label>
          {t('外观', 'Appearance')}
          <select
            aria-label={t('外观', 'Appearance')}
            value={state.settings.theme}
            onChange={(e) => set('theme', e.target.value as typeof state.settings.theme)}
          >
            <option value="system">{t('跟随系统', 'System')}</option>
            <option value="light">{t('浅色', 'Light')}</option>
            <option value="dark">{t('深色', 'Dark')}</option>
          </select>
        </label>
        <label>
          {t('语言', 'Language')}
          <select
            aria-label={t('语言', 'Language')}
            value={state.settings.language}
            onChange={(e) => set('language', e.target.value as 'zh' | 'en')}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {t('桌面端发送快捷键', 'Desktop send shortcut')}
          <select
            aria-label={t('桌面端发送快捷键', 'Desktop send shortcut')}
            value={state.settings.sendKey}
            onChange={(e) => set('sendKey', e.target.value as typeof state.settings.sendKey)}
          >
            <option value="enter">Enter</option>
            <option value="mod">⌘ / Ctrl + Enter</option>
            <option value="ctrl">Ctrl + Enter</option>
            <option value="alt">Option / Alt + Enter</option>
          </select>
          <small>
            {t(
              'Shift + Enter 始终换行。手机上 Enter 换行，点击按钮发送；输入法选词不会误发送。',
              'Shift + Enter always adds a line. On phones, Enter adds a line; tap to send. IME composition never sends.',
            )}
          </small>
        </label>
        <div className="info-box">
          <CircleHelp size={18} />
          <p>
            {t(
              '手机可通过浏览器“添加到主屏幕”安装。此版本需要联网调用模型，不会缓存聊天接口。',
              'Add Chatbutte to your home screen from your browser. Model requests require a network connection; chat APIs are not cached.',
            )}
          </p>
        </div>
      </div>
    </>
  );
}
function Data() {
  const { state } = useStore();
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [secrets, setSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (anyRunning()) {
      notify(t('请先停止正在进行的生成', 'Stop active generations first'));
      return;
    }
    setBusy(true);
    try {
      await withWorkspaceOperation('import', fn);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      if (file.size > 80 * 1024 * 1024)
        throw new Error(t('备份不能超过 80MB', 'Backup must be under 80 MB'));
      const parsed = parseImport(JSON.parse(await file.text()), state.settings.language);
      if (
        !confirm(
          t(
            `将替换本机数据：${parsed.conversations.length} 个会话、${parsed.profiles.length} 个模型。导入前会保留恢复点。继续？`,
            `Replace local data with ${parsed.conversations.length} conversations and ${parsed.profiles.length} models? A restore point will be kept. Continue?`,
          ),
        )
      )
        return;
      await replaceState(parsed);
      notify(t('导入成功', 'Backup imported'));
    });
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>{t('你的数据，由你掌握', 'Your data stays yours')}</h3>
          <p>
            {t(
              '会话与附件保存在此浏览器的 IndexedDB 中。',
              'Conversations and attachments live in this browser’s IndexedDB.',
            )}
          </p>
        </div>
      </div>
      <div className="stats-row">
        <div>
          <strong>{state.conversations.length}</strong>
          <span>{t('个会话', 'conversations')}</span>
        </div>
        <div>
          <strong>
            {state.conversations.reduce(
              (n, c) => n + c.messages.filter((m) => m.role !== 'divider').length,
              0,
            )}
          </strong>
          <span>{t('条消息', 'messages')}</span>
        </div>
        <div>
          <strong>{state.profiles.length}</strong>
          <span>{t('个模型', 'models')}</span>
        </div>
      </div>
      <section className="data-card">
        <h4>{t('导出备份', 'Export a backup')}</h4>
        <p>
          {t(
            '完整保留会话、附件与偏好。默认不包含密钥。',
            'Conversations, attachments and preferences. Keys are excluded by default.',
          )}
        </p>
        <label className="check-label">
          <input type="checkbox" checked={secrets} onChange={(e) => setSecrets(e.target.checked)} />
          {t('包含模型 API 密钥（请妥善保管）', 'Include model API keys (keep this file private)')}
        </label>
        <button className="button secondary" onClick={() => downloadBackup(secrets)}>
          <Download size={17} />
          {t('导出 JSON', 'Export JSON')}
        </button>
      </section>
      <section className="data-card">
        <h4>{t('导入或恢复', 'Import or restore')}</h4>
        <p>
          {t(
            '支持新版备份与旧版 Chatbutte 数据。导入前校验，失败不改动现有数据。',
            'Accepts current and legacy Chatbutte backups. Validation happens before replacing your data.',
          )}
        </p>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={17} />
            {t('导入备份', 'Import backup')}
          </button>
          <button
            className="button ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (
                  confirm(
                    t('恢复导入/重置前的数据？', 'Restore data from before the last import/reset?'),
                  )
                ) {
                  await restorePoint();
                  notify(t('已恢复', 'Restored'));
                }
              })
            }
          >
            {t('恢复上次替换前数据', 'Undo last replacement')}
          </button>
        </div>
        <input
          ref={input}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </section>
      <div className="info-box">
        <ShieldCheck size={18} />
        <p>
          {t(
            '浏览器清理网站数据、无痕模式或换设备都会影响本地数据。请定期导出备份。旧版已经丢失的附件无法凭空恢复，会明确标记。',
            'Clearing site data, private browsing or changing devices can remove local data. Export backups regularly. Attachments lost by the old version are marked, not silently recreated.',
          )}
        </p>
      </div>
      <section className="data-card danger-zone">
        <h4>{t('重置工作区', 'Reset workspace')}</h4>
        <p>
          {t(
            '删除当前浏览器中的模型和会话。此操作有二次确认并保留一个恢复点。',
            'Remove models and conversations in this browser. Requires a second confirmation and keeps a restore point.',
          )}
        </p>
        <button
          className="button danger secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (
                confirm(
                  t(
                    '确定重置工作区？建议先导出备份。',
                    'Reset the workspace? Export a backup first.',
                  ),
                ) &&
                prompt(t('输入 RESET 确认', 'Type RESET to confirm')) === 'RESET'
              ) {
                await replaceState(emptyState(), false);
                notify(t('工作区已重置', 'Workspace reset'));
              }
            })
          }
        >
          <Trash2 size={16} />
          {t('重置数据', 'Reset data')}
        </button>
      </section>
    </>
  );
}
function Sync() {
  const { state } = useStore();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [show, setShow] = useState(false);
  const set = (key: 'gistToken' | 'gistId', value: string) =>
    update((s) => ({
      ...s,
      settings: {
        ...s.settings,
        [key]: value.trim(),
        gistRevision: key === 'gistId' ? '' : s.settings.gistRevision,
      },
    }));
  const sync = async (direction: 'up' | 'down') => {
    if (anyRunning()) {
      notify(t('请先停止生成再同步', 'Stop active generations before syncing'));
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      await flush();
      const result = direction === 'up' ? await uploadGist(confirm) : await downloadGist(confirm);
      setStatus(
        result
          ? t('操作完成', 'Operation completed')
          : t('已取消，未改动数据', 'Cancelled. No data was changed'),
      );
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>{t('在设备之间，手动接力', 'Pick up on another device')}</h3>
          <p>
            {t(
              '通过你自己的私密 GitHub Gist 备份，不自动覆盖。',
              'Manual backups to your own secret GitHub Gist. Never auto-overwritten.',
            )}
          </p>
        </div>
      </div>
      <div className="settings-form">
        <label>
          GitHub Gist Token
          <div className="secret-field">
            <input
              aria-label="GitHub Gist Token"
              type={show ? 'text' : 'password'}
              value={state.settings.gistToken}
              disabled={busy}
              onChange={(e) => set('gistToken', e.target.value)}
              autoComplete="off"
              placeholder="ghp_…"
              spellCheck={false}
            />
            <IconButton
              label={t('显示或隐藏 Token', 'Show or hide token')}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </IconButton>
          </div>
          <small>
            {t(
              '需要 gist 权限。Token 仅保存在本机，不写入备份。填写后自动保存。',
              'Requires gist scope. Stored locally and excluded from backups. Saved as you type.',
            )}
          </small>
        </label>
        <label>
          Gist ID
          <input
            value={state.settings.gistId}
            disabled={busy}
            onChange={(e) => set('gistId', e.target.value)}
            placeholder={t('首次上传时自动创建', 'Created automatically on first upload')}
            spellCheck={false}
          />
        </label>
        <div className="info-box">
          <ShieldCheck size={18} />
          <p>
            {t(
              '上传包含聊天与附件，默认排除所有 API 密钥与 Token。私密 Gist 并非端到端加密；持有链接的人仍可能访问。下载会替换本机数据，先保留恢复点。同 ID 模型的本机密钥会保留。',
              'Uploads include chats and attachments but exclude API keys and tokens. Secret Gists are not end-to-end encrypted; anyone with the link may be able to access them. Downloads replace local data with a restore point; matching local model keys are retained.',
            )}
          </p>
        </div>
        <div className="button-row">
          <button
            className="button primary"
            disabled={busy || !state.settings.gistToken}
            onClick={() => void sync('up')}
          >
            <Upload size={17} />
            {busy ? t('处理中…', 'Working…') : t('上传本机备份', 'Upload this device')}
          </button>
          <button
            className="button secondary"
            disabled={busy || !state.settings.gistId || !state.settings.gistToken}
            onClick={() => void sync('down')}
          >
            <Download size={17} />
            {t('下载云端备份', 'Download backup')}
          </button>
        </div>
        {status && (
          <p role="status" className="sync-status">
            {status}
          </p>
        )}
        <a
          className="text-link"
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noreferrer"
        >
          {t('管理 GitHub Token', 'Manage GitHub tokens')}
          <ExternalLink size={14} />
        </a>
      </div>
    </>
  );
}
