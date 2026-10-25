// One workspace replacement/sync at a time; never race a model run with a replacement.
let exclusive = '';
const runs = new Set<string>();
export const workspaceOperation = () => exclusive;
export const anyRun = () => runs.size > 0;
export function assertNoRuns() {
  if (runs.size)
    throw new Error('Stop active generations before replacing data / 请先停止生成再替换数据');
}
export function beginRun(id: string) {
  if (exclusive) throw new Error('A backup operation is in progress / 正在处理备份，请稍候');
  if (runs.has(id)) throw new Error('This conversation is already generating / 此会话正在生成');
  if (runs.size >= 3) throw new Error('Up to 3 simultaneous generations / 最多同时生成 3 个会话');
  runs.add(id);
  return () => {
    runs.delete(id);
  };
}
export async function withWorkspaceOperation<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (exclusive) throw new Error('Another backup operation is in progress / 已有备份操作正在进行');
  assertNoRuns();
  exclusive = name;
  try {
    return await fn();
  } finally {
    exclusive = '';
  }
}
