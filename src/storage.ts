import { legacyKey } from "./legacyKeys";

export const STORAGE_KEYS = {
  app: "hguox_app_v1",
  swipeEp: "hguox_swipe_ep_v2",
  theme: "hguox_theme",
  autoLine: "hguox_auto_line",
} as const;

/** 封面色链路用的额外键（不属于上游 STORAGE_KEYS 的命名空间） */
export const EXTRA_STORAGE_KEYS = {
  lastAccent: "hguox_last_accent_v1",
  accentCache: "hguox_accent_cache_v1",
} as const;

type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

/* 旧键仅用于升级迁移，运行期始终向 STORAGE_KEYS 里的键写入。
   每一档两个候选：上一代品牌前缀（见 legacyKeys.ts）+ 更早的 hghub 时代键名。 */
const LEGACY_KEYS: Record<StorageKey, string[]> = {
  hguox_app_v1: [legacyKey("app_v1"), "hghub_app_v1"],
  hguox_swipe_ep_v2: [legacyKey("swipe_ep_v2"), "hghub_swipe_ep_v2"],
  hguox_theme: [legacyKey("theme"), "hghub_theme"],
  hguox_auto_line: [legacyKey("auto_line"), "hg.autoLine"],
};

/** 新键优先；确认旧数据已写入新键后才删除旧键。存储写入失败仍可读取旧数据。 */
export function readStorage(key: StorageKey): string | null {
  try {
    const legacyKeys = LEGACY_KEYS[key];
    const current = localStorage.getItem(key);
    if (current !== null) {
      for (const k of legacyKeys) { try { localStorage.removeItem(k); } catch { /* 下次启动重试清理 */ } }
      return current;
    }
    for (const legacyKeyName of legacyKeys) {
      const legacy = localStorage.getItem(legacyKeyName);
      if (legacy === null) continue;
      try {
        localStorage.setItem(key, legacy);
        if (localStorage.getItem(key) === legacy) localStorage.removeItem(legacyKeyName);
      } catch { /* 配额不足或禁止写入时保留旧数据，下次启动重试 */ }
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}
