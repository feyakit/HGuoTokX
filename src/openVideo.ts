import { isMobile } from "./api";
import type { PageInput } from "./store";

type Push = (page: PageInput) => void;

/** 手机进全屏剧内播放器。桌面仍走原来的连播页，避免改桌面测试。 */
export function openTitles(push: Push, ids: number[], index: number, title: string, extra?: { startEp?: number; startTime?: number }) {
  const id = ids[Math.max(0, index)] ?? ids[0];
  if (isMobile && id) {
    push({ kind: "series", videoId: id, title, startEp: extra?.startEp, startTime: extra?.startTime });
    return;
  }
  push({ kind: "feed", videoIds: ids, index: Math.max(0, index), title, startEp: extra?.startEp, startTime: extra?.startTime });
}
