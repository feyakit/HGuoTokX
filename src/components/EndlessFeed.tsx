import { useCallback, useRef, useState } from "react";
import { api } from "../api";
import EpisodePlayer from "./EpisodePlayer";
import { Button } from "./ios/controls";

/**
 * 「抖音模式」外壳：在全屏沉浸 feed 之上加一层「无限流」。
 *
 * 内核（播放、手势、控件、选集、进度）全在 EpisodePlayer 里；这里只做三件事：
 *  1. 持有 ids —— 滑动到剩 3 条时向推荐接口要下一页、去重追加，当前条不跳；
 *  2. 没有更多了就置 exhausted，末尾给一张「已刷完 · 回首页」的卡，不造假内容；
 *  3. 拉取失败只是不追加（不置 exhausted），下次滑动再试——线路自动切换在 autoLine 里。
 *
 * 内部标识用中性名（endless），「抖音模式」只出现在 UI 文案里。
 */

const NEAR_END = 3;
const PAGE_SIZE = 20;

const dedupe = (ids: number[], seen: Set<number>): number[] => {
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

export default function EndlessFeed({ seedIds, startIndex = 0, title = "", bottomInset = 0, active, onBack }: {
  seedIds: number[];
  startIndex?: number;
  title?: string;
  bottomInset?: number;
  active: boolean;
  onBack: () => void;
}) {
  const seen = useRef<Set<number>>(new Set());
  const [ids, setIds] = useState<number[]>(() => dedupe(seedIds, seen.current));
  /* 只在挂载时算一次：去重后长度可能变短，越界要夹回来；之后 index 由播放器回调同步 */
  const initialIndex = useRef(Math.max(0, Math.min(startIndex, Math.max(0, ids.length - 1)))).current;
  const [index, setIndex] = useState(initialIndex);
  const [exhausted, setExhausted] = useState(false);
  const page = useRef(1);
  const loading = useRef(false);

  const loadMore = useCallback(async () => {
    if (loading.current || exhausted) return;
    loading.current = true;
    try {
      const next = page.current + 1;
      const res = await api.feed(next, PAGE_SIZE);
      const items = res?.items || [];
      page.current = next;
      const fresh = dedupe(items.map(item => item.id), seen.current);
      if (fresh.length) setIds(prev => [...prev, ...fresh]);
      const pages = res?.pagination?.pages;
      if (!items.length || !fresh.length || (typeof pages === "number" && next >= pages)) setExhausted(true);
    } catch { /* 网络/线路问题：保持现状，下次滑到尾部再试 */ }
    finally { loading.current = false; }
  }, [exhausted]);

  const atEnd = exhausted && ids.length > 0 && index >= ids.length - 1;

  return (
    <div className="absolute inset-0">
      <EpisodePlayer videoIds={ids} startIndex={initialIndex} title={title} kind="video"
        mode="context" endless active={active} bottomInset={bottomInset} onBack={onBack}
        onNearEnd={() => { if (index >= ids.length - NEAR_END) void loadMore(); }}
        onActiveIndex={setIndex} />
      {atEnd && (
        <div className="hg-binge-end" role="dialog" aria-label="已刷完">
          <p className="hg-binge-end-text">已刷完 · 共 {ids.length} 部</p>
          <Button onClick={onBack} className="hg-binge-end-btn">回首页</Button>
        </div>
      )}
    </div>
  );
}
