/* 「不感兴趣」的本地记忆（抖音模式 / 刷剧流）。
 *
 * 需求（v3.0.6 #5）：点「不感兴趣」要真的①立刻跳下一条 ②以后不再出现在刷剧流里
 * ③后端没有不喜欢接口就只做本地。所以这里只存 id + 时间，不上报、不动服务端数据。
 * 30 天自然过期、最多 200 条：既能让用户「眼不见」，又不会把池子永久吃空。
 */
const KEY = "hguox_dislike_v1";
const TTL = 30 * 24 * 60 * 60 * 1000;
const MAX = 200;

type Entry = { id: number; at: number };

function load(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((item): item is Entry =>
        !!item && typeof item === "object"
        && Number.isFinite((item as Entry).id) && Number.isFinite((item as Entry).at)
        && now - (item as Entry).at < TTL)
      .slice(-MAX);
  } catch {
    return [];
  }
}

function save(entries: Entry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX))); } catch { /* 配额/隐私模式：本次运行仍按内存值走 */ }
}

/** 当前仍在有效期内的「不感兴趣」id（每次调用都读一遍，避免多标签/多页面不同步）。 */
export function readDislikedIds(): Set<number> {
  return new Set(load().map(entry => entry.id));
}

export function markDisliked(id: number) {
  if (!Number.isFinite(id)) return;
  const entries = load().filter(entry => entry.id !== id);
  entries.push({ id, at: Date.now() });
  save(entries);
}

export function isDisliked(id: number): boolean {
  return readDislikedIds().has(id);
}
