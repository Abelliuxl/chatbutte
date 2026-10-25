import { exportState } from './domain';
import { parseImport } from './migration';
import { getState, update, replaceState, requireWritable } from './store';
import { withWorkspaceOperation } from './operations';
const filename = 'chatbutte-data.json';
async function github(path: string, method = 'GET', value?: unknown) {
  const token = getState().settings.gistToken;
  if (!token) throw new Error('Enter and save a Gist token first / 请先填写并保存 Gist Token');
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(value ? { 'Content-Type': 'application/json' } : {}),
    },
    body: value ? JSON.stringify(value) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json()).message;
    } catch {}
    throw new Error(`GitHub ${response.status}: ${detail}`);
  }
  return response.json();
}
export function uploadGist(confirmOverwrite: (message: string) => boolean) {
  return withWorkspaceOperation('upload', async () => {
    requireWritable();
    const state = getState(),
      settings = state.settings;
    const content = JSON.stringify(exportState(state));
    if (new Blob([content]).size > 10 * 1024 * 1024)
      throw new Error(
        'Gist backup exceeds 10 MB. Export a local backup instead / 数据超过 10MB，请使用本地备份',
      );
    if (settings.gistId) {
      const remote = await github(`/gists/${encodeURIComponent(settings.gistId)}`);
      if (remote.public)
        throw new Error(
          'Refusing to upload private chats to a public Gist / 不向公开 Gist 上传私人会话',
        );
      const revision = remote.history?.[0]?.version || remote.updated_at;
      if (
        revision !== settings.gistRevision &&
        !confirmOverwrite(
          'Remote backup has changed or has not been compared. Replace it with this device? / 云端版本不同或尚未比较，确定用本机覆盖？',
        )
      )
        return false;
    }
    const result = await github(
      settings.gistId ? `/gists/${encodeURIComponent(settings.gistId)}` : '/gists',
      settings.gistId ? 'PATCH' : 'POST',
      {
        ...(settings.gistId
          ? {}
          : { description: 'Chatbutte private backup — API keys excluded', public: false }),
        files: { [filename]: { content } },
      },
    );
    update((s) => ({
      ...s,
      settings: {
        ...s.settings,
        gistId: result.id,
        gistRevision: result.history?.[0]?.version || result.updated_at,
      },
    }));
    return true;
  });
}
export function downloadGist(confirmReplace: (message: string) => boolean) {
  return withWorkspaceOperation('download', async () => {
    requireWritable();
    const settings = getState().settings;
    if (!/^[a-zA-Z0-9]+$/.test(settings.gistId))
      throw new Error('Enter a valid Gist ID / 请填写有效的 Gist ID');
    const remote = await github(`/gists/${settings.gistId}`);
    const file = remote.files?.[filename];
    if (!file) throw new Error('chatbutte-data.json not found / 未找到 Chatbutte 备份文件');
    let content = file.content;
    if (file.truncated) {
      const u = new URL(file.raw_url);
      if (u.protocol !== 'https:' || u.hostname !== 'gist.githubusercontent.com')
        throw new Error('Unexpected Gist download host');
      const response = await fetch(u, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('Gist download failed');
      content = await response.text();
    }
    if (new Blob([content]).size > 40 * 1024 * 1024) throw new Error('Remote backup too large');
    const value = parseImport(JSON.parse(content), getState().settings.language);
    if (
      !confirmReplace(
        `Replace local data with ${value.conversations.length} conversations? A local restore point will be kept. / 用云端 ${value.conversations.length} 个会话替换本机？将保留恢复点。`,
      )
    )
      return false;
    value.settings.gistId = settings.gistId;
    value.settings.gistToken = settings.gistToken;
    value.settings.gistRevision = remote.history?.[0]?.version || remote.updated_at;
    await replaceState(value);
    return true;
  });
}
