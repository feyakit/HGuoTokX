/* 线路偏好：手动选线只表示「本次优先」，不是永久关闭自动选线（3.0.0 之前的 off 语义已废）。
 *
 * 为什么单独一个键：`hguox_auto_line` = 用户要不要自动选线（设置页开关），
 * `hguox_line_preferred` = 用户更想用哪条（手动点的那条）。两件事不该共用一个布尔。
 * 策略本身（何时切/何时不切）在 linePolicy.ts，无副作用、可单测。
 */
import { readStorage, STORAGE_KEYS } from "../storage/storage";

/** 旧版本「手动选线 → auto_line=off」的一次性迁移标记（见 migrateLegacyAutoLine） */
const MIGRATED_KEY = "hguox_auto_line_v2";

/** 去尾斜杠；空串表示「没有偏好」 */
export function normalizeBase(url: string | null | undefined): string {
  if (!url) return "";
  return url.trim().replace(/\/+$/, "");
}

export function readPreferredLine(): string {
  try {
    return normalizeBase(localStorage.getItem(STORAGE_KEYS.linePreferred));
  } catch {
    return "";
  }
}

/** 写/清偏好。清（null）用「恢复主站」时，表示回到完全自动。 */
export function setPreferredLine(url: string | null | undefined): void {
  const next = normalizeBase(url);
  try {
    if (next) localStorage.setItem(STORAGE_KEYS.linePreferred, next);
    else localStorage.removeItem(STORAGE_KEYS.linePreferred);
  } catch { /* 配额或隐私模式下写不进去，本次运行仍按内存值走 */ }
  window.dispatchEvent(new Event("hg:line-preference-changed"));
}

/**
 * 旧版本的 `auto_line=off` 是「手动选过一次线」的副作用，不代表用户想关自动选线。
 * 升级后第一次启动把 off 当作无效意图恢复成 on，并写下迁移标记；
 * 之后用户在设置里主动关掉的 off 才是真的关（有标记，不再迁移）。
 */
export function migrateLegacyAutoLine(): void {
  let migrated = true;
  try { migrated = localStorage.getItem(MIGRATED_KEY) !== null; } catch { return; }
  if (migrated) return;
  try {
    if (readStorage(STORAGE_KEYS.autoLine) === "off") {
      localStorage.setItem(STORAGE_KEYS.autoLine, "on");
    }
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch { /* 写不进去就下次启动再试 */ }
}
