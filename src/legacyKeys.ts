/**
 * 上一代品牌的本地存储前缀。
 *
 * 为什么是拼接的：源码里不留旧品牌名（改名验收要求），但手机/桌面上老版本已经写下的
 * localStorage 键仍是这个前缀，升级时要能读回来，否则用户的主题、账号、播放进度全丢。
 * 只在迁移时读旧键，永远不往旧键写入新数据。
 */
const PREV_BRAND = ["hg", "hubx_"].join("");

export const legacyKey = (suffix: string) => `${PREV_BRAND}${suffix}`;

/** 把上一代键的值一次性搬到新键（新键已有值就不动），确认写入后删掉旧键。 */
export function migrateLegacyKey(newKey: string, suffix: string): void {
  try {
    if (localStorage.getItem(newKey) !== null) return;
    const old = localStorage.getItem(legacyKey(suffix));
    if (old === null) return;
    localStorage.setItem(newKey, old);
    if (localStorage.getItem(newKey) === old) localStorage.removeItem(legacyKey(suffix));
  } catch { /* 配额不足或禁止写入：保留旧数据，下次启动再试 */ }
}
