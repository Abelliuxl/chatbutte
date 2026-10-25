import { useSyncExternalStore } from 'react';
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { emptyState, exportState, StateSchema, type State, type Conversation } from './domain';
import { parseImport } from './migration';
import { assertNoRuns } from './operations';

interface Snapshot {
  state: State;
  ready: boolean;
  saving: boolean;
  error: string;
  notice: string;
  readOnly: boolean;
  recovery: boolean;
}
let snapshot: Snapshot = {
  state: emptyState(),
  ready: false,
  saving: false,
  error: '',
  notice: '',
  readOnly: true,
  recovery: false,
};
const listeners = new Set<() => void>();
const dbPromise = openDB('chatbutte-v2', 1, {
  upgrade(db) {
    db.createObjectStore('workspace');
  },
});
const owner = crypto.randomUUID();
let writer = false,
  fallbackLease = false;
let releaseLock: (() => void) | undefined;
let timer: ReturnType<typeof setTimeout> | undefined,
  maxTimer: ReturnType<typeof setTimeout> | undefined;
let pending: State | undefined, writing: Promise<void> | undefined, lastSaved: State | undefined;
const publish = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useStore = () => useSyncExternalStore(subscribe, () => snapshot);
export const useLanguage = () =>
  useSyncExternalStore(subscribe, () => snapshot.state.settings.language);
export const useWritable = () =>
  useSyncExternalStore(subscribe, () => writer && !snapshot.readOnly && !snapshot.recovery);
export const getState = () => snapshot.state;
export const canWrite = () => writer && !snapshot.readOnly && !snapshot.recovery;
export function requireWritable(allowRecovery = false) {
  if (!writer || snapshot.readOnly || (!allowRecovery && snapshot.recovery))
    throw new Error(
      'Workspace is read-only; close other tabs or recover your data / 工作区当前只读，请关闭其他标签页或恢复数据',
    );
}
export const notify = (notice: string) => publish({ notice });
export const dismissNotice = () => publish({ notice: '' });
function scheduleSave() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void flush().catch(() => {});
  }, 250);
  maxTimer ??= setTimeout(() => {
    void flush().catch(() => {});
  }, 1500);
}
export function update(fn: (state: State) => State): boolean {
  try {
    requireWritable();
  } catch (e) {
    notify((e as Error).message);
    return false;
  }
  const state = fn(snapshot.state);
  if (state === snapshot.state) return true;
  publish({ state, saving: true });
  pending = state;
  scheduleSave();
  return true;
}
export function editConversation(id: string, fn: (c: Conversation) => Conversation) {
  return update((s) => ({
    ...s,
    conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)),
  }));
}
async function verifyLease(
  db: IDBPDatabase,
  tx?: IDBPTransaction<unknown, ['workspace'], 'readwrite'>,
) {
  if (!fallbackLease) return;
  const lease = tx
    ? await tx.objectStore('workspace').get('writer-lease')
    : await db.get('workspace', 'writer-lease');
  if (lease?.owner !== owner || lease.until < Date.now()) {
    writer = false;
    publish({ readOnly: true });
    throw new Error('Writer lease expired. Reload this tab / 写入锁已过期，请刷新');
  }
}
export function flush(): Promise<void> {
  clearTimeout(timer);
  clearTimeout(maxTimer);
  maxTimer = undefined;
  if (writing) return writing;
  if (!pending) return Promise.resolve();
  writing = (async () => {
    try {
      const db = await dbPromise;
      while (pending) {
        requireWritable();
        const value: State = pending;
        StateSchema.parse(value); // Never persist data that this app cannot read back.
        const tx = db.transaction('workspace', 'readwrite');
        try {
          await verifyLease(db, tx);
          if (lastSaved) await tx.store.put(lastSaved, 'backup');
          await tx.store.put(value, 'current');
          await tx.done;
        } catch (error) {
          try {
            tx.abort();
          } catch {}
          await tx.done.catch(() => {});
          throw error;
        }
        lastSaved = value;
        if (pending === value) pending = undefined;
      }
      publish({ saving: false, error: '' });
    } catch (e) {
      publish({
        saving: false,
        error: `Storage failed — export a backup now / 存储失败，请立即导出备份：${(e as Error).message}`,
      });
      throw e; // Keep pending for retry; explicit import/sync must not report false success.
    }
  })().finally(() => {
    writing = undefined;
  });
  return writing;
}
async function acquireWriter(db: IDBPDatabase): Promise<boolean> {
  if (navigator.locks) {
    return new Promise<boolean>((resolve, reject) => {
      void navigator.locks
        .request('chatbutte-workspace-writer', { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          writer = true;
          const held = new Promise<void>((release) => {
            releaseLock = release;
          });
          resolve(true);
          await held;
          writer = false;
        })
        .catch(reject);
    });
  }
  // Transactional expiring lease for browsers without Web Locks.
  fallbackLease = true;
  const tx = db.transaction('workspace', 'readwrite');
  const lease = await tx.store.get('writer-lease');
  if (lease && lease.until > Date.now()) {
    await tx.done;
    return false;
  }
  await tx.store.put({ owner, until: Date.now() + 15000 }, 'writer-lease');
  await tx.done;
  writer = true;
  const heartbeat = setInterval(() => {
    void (async () => {
      const tx = db.transaction('workspace', 'readwrite');
      const lease = await tx.store.get('writer-lease');
      if (lease?.owner !== owner) {
        writer = false;
        publish({ readOnly: true });
        clearInterval(heartbeat);
      } else await tx.store.put({ owner, until: Date.now() + 15000 }, 'writer-lease');
      await tx.done;
    })().catch(() => {
      writer = false;
      publish({ readOnly: true });
      clearInterval(heartbeat);
    });
  }, 3000);
  releaseLock = () => {
    clearInterval(heartbeat);
    writer = false;
    void (async () => {
      const tx = db.transaction('workspace', 'readwrite');
      const lease = await tx.store.get('writer-lease');
      if (lease?.owner === owner) await tx.store.delete('writer-lease');
      await tx.done;
    })().catch(() => {});
  };
  return true;
}
export async function initialize() {
  try {
    const db = await dbPromise;
    const writable = await acquireWriter(db); // Acquire BEFORE migration, repair or any other write.
    const current = await db.get('workspace', 'current');
    let state: State;
    let notice = '';
    if (current) {
      try {
        state = parseImport(current);
      } catch {
        const backup = await db.get('workspace', 'backup');
        if (!backup)
          throw new Error(
            'Stored data is damaged. Import a backup to recover / 本地数据损坏，请导入备份恢复',
          );
        state = parseImport(backup);
        notice = 'Recovered the previous local backup / 已从上一次本地备份恢复';
      }
    } else {
      let legacy: string | null = null,
        legacyBackup: string | null = null;
      try {
        legacy = localStorage.getItem('chatbutte_state_v1');
        legacyBackup = localStorage.getItem('chatbutte_state_v1_backup');
      } catch {}
      if (legacy || legacyBackup) {
        const language = localStorage.getItem('chatbutte_language') === 'en' ? 'en' : 'zh';
        try {
          state = parseImport(JSON.parse(legacy || legacyBackup!), language);
        } catch {
          if (!legacyBackup || legacyBackup === legacy)
            throw new Error(
              'Legacy migration failed. Original data is untouched / 旧数据迁移失败，原数据未被修改',
            );
          state = parseImport(JSON.parse(legacyBackup), language);
        }
        if (writable)
          await db.put('workspace', { primary: legacy, backup: legacyBackup }, 'legacy-original');
        notice =
          'Your conversations and models have been migrated. The original data is untouched / 会话与模型已迁移，旧版原数据仍保留';
      } else state = emptyState();
      if (writable) await db.put('workspace', state, 'current');
    }
    lastSaved = state;
    publish({ state, ready: true, readOnly: !writable, recovery: false, notice });
    if (writable && current && JSON.stringify(current) !== JSON.stringify(state)) {
      pending = state;
      await flush();
    }
  } catch (e) {
    // Do not turn damaged/temporarily unreadable data into an empty persisted workspace.
    publish({ ready: true, recovery: true, readOnly: !writer, error: (e as Error).message });
  }
}
export async function replaceState(input: State, retainCredentials = true) {
  requireWritable(true);
  assertNoRuns();
  const value = StateSchema.parse(input); // Validate completely before opening the replacement transaction.
  if (!snapshot.recovery) await flush();
  const old = snapshot.state;
  if (retainCredentials) {
    value.profiles = value.profiles.map((p) => ({
      ...p,
      apiKey:
        p.apiKey ||
        old.profiles.find((x) => x.id === p.id && x.apiUrl === p.apiUrl && x.model === p.model)
          ?.apiKey ||
        '',
    }));
    value.settings = {
      ...value.settings,
      gistToken: value.settings.gistToken || old.settings.gistToken,
      gistId: value.settings.gistId || old.settings.gistId,
    };
  }
  const db = await dbPromise;
  const tx = db.transaction('workspace', 'readwrite');
  try {
    await verifyLease(db, tx);
    const original = await tx.store.get('current');
    await tx.store.put(original || old, 'restore-point');
    if (lastSaved) await tx.store.put(lastSaved, 'backup');
    await tx.store.put(value, 'current');
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
  pending = undefined;
  lastSaved = value;
  publish({ state: value, recovery: false, saving: false, error: '' });
}
export async function restorePoint() {
  requireWritable(true);
  assertNoRuns();
  const value = await (await dbPromise).get('workspace', 'restore-point');
  if (!value) throw new Error('No restore point / 暂无导入前恢复点');
  await replaceState(parseImport(value));
}
export function downloadBackup(includeSecrets = false) {
  const blob = new Blob([JSON.stringify(exportState(snapshot.state, includeSecrets), null, 2)], {
    type: 'application/json',
  });
  downloadBlob(
    blob,
    `chatbutte-${new Date().toISOString().slice(0, 10)}${includeSecrets ? '-with-keys' : ''}.json`,
  );
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
window.addEventListener('pagehide', () => {
  void flush()
    .finally(() => {
      writer = false;
      releaseLock?.();
    })
    .catch(() => {});
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) void flush().catch(() => {});
});
