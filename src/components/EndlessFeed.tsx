import { useCallback, useEffect, useRef, useState } from "react";
import { api, logLine } from "../api";
import { readDislikedIds } from "../feedPrefs";
import { pickLine } from "../autoLine";
import EpisodePlayer from "./EpisodePlayer";
import { Button } from "./ios/controls";

/**
 * 「抖音模式」外壳：全站随机、真·无限刷。
 *
 * 取数口径：
 *  - `api.feed(page, size)` 就是 /api/videos；先拉第 1 页拿 total 算出总页数；
 *  - 每批随机挑 2–3 个页码并发拉取 → 合并 → 洗牌 → 去重 → append；
 *  - 预取：剩余未播 < 3 条就立刻补（onNearEnd 只是其中一条触发路径），快速划也不会空位；
 *  - 失败：当前条照常播，后台按 2/4/8/16/30s（封顶）退避重试，成功后静默续上，**不弹任何提示**；
 *  - 去重只看最近 300 个已播 id（FIFO 淘汰），内存有上限；很久以后允许重新刷到同一部；
 *  - 没有「已刷完」这回事：池子枯竭就清空重洗，永远不停。
 *
 * 内部标识用中性名（endless），「抖音模式」只出现在 UI 文案里。
 */

const NEAR_END = 3;
const PAGE_SIZE = 20;
/** 每批随机页码数：2–3 */
const PICK_MIN = 2;
const PICK_MAX = 3;
/** 去重窗口：只记最近 300 个已播 id */
const SEEN_MEMORY = 300;
/** 失败退避：2s → 4s → 8s → 16s → 30s（封顶） */
const BACKOFF_BASE = 2000;
const BACKOFF_MAX = 30000;
/** 池子最多领先当前条这么多条，防止判定失灵时无限追加 */
const GROW_AHEAD_MAX = 60;

type Card = { id: number };

const shuffle = <T,>(list: T[]): T[] => {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** 在 [1, total] 里取 count 个互不相同的页码 */
const pickPages = (total: number, count: number): number[] => {
  const max = Math.max(1, total);
  const picked = new Set<number>();
  while (picked.size < Math.min(count, max)) picked.add(1 + Math.floor(Math.random() * max));
  return [...picked];
};

export default function EndlessFeed({ title = "", bottomInset = 0, active, onBack }: {
  title?: string;
  bottomInset?: number;
  active: boolean;
  onBack: () => void;
}) {
  const seen = useRef<Set<number>>(new Set());
  const seenOrder = useRef<number[]>([]);
  const pages = useRef(0);
  const loading = useRef(false);
  const retryTimer = useRef(0);
  const backoffStep = useRef(0);
  const alive = useRef(true);
  const [ids, setIds] = useState<number[]>([]);
  const idsRef = useRef<number[]>([]);
  const indexRef = useRef(0);
  const [booting, setBooting] = useState(true);
  /* 取数连续失败：不能只留一块黑屏，要告诉用户并给重试（真机取证用） */
  const [bootFailed, setBootFailed] = useState(false);
  const [index, setIndex] = useState(0);
  idsRef.current = ids;
  indexRef.current = index;

  useEffect(() => {
    /* 挂载时必须复位：StrictMode 或任何一次重挂载都会跑一次 cleanup（alive=false），
       不复位的话 bootstrap/pull 会一直提前 return，界面上永远是「正在随机挑剧…」。 */
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(retryTimer.current);
      retryTimer.current = 0;
    };
  }, []);

  /* 一次请求可能正好赶上坏线路：先让自动选线强制重选一次，再试同一批页码 */
  const requestPages = useCallback(async (list: number[]): Promise<{ items: Card[]; totalPages: number; ok: boolean }> => {
    const grab = async () => {
      const results = await Promise.all(list.map(page => api.feed(page, PAGE_SIZE)));
      return {
        items: results.flatMap(result => (result?.items || []) as Card[]),
        totalPages: results.reduce((max, result) => Math.max(max, Number(result?.pagination?.pages) || 0), 0),
        ok: true,
      };
    };
    try {
      return await grab();
    } catch {
      try { await pickLine("binge-retry", true); } catch { /* 线路也救不回来就走空结果 */ }
      try { return await grab(); } catch { return { items: [], totalPages: 0, ok: false }; }
    }
  }, []);

  /** 洗牌后的候选里取没播过的；超过 300 个就丢掉最旧的（允许很久以后重刷到） */
  const takeFresh = useCallback((items: Card[]): number[] => {
    const fresh: number[] = [];
    /* 「不感兴趣」的剧不再进池子（本地记忆，30 天 / 200 条，见 feedPrefs.ts） */
    const disliked = readDislikedIds();
    for (const item of items) {
      const id = Number(item?.id);
      if (!Number.isFinite(id) || id <= 0 || seen.current.has(id) || disliked.has(id)) continue;
      if (seenOrder.current.length >= SEEN_MEMORY) {
        const oldest = seenOrder.current.shift();
        if (oldest !== undefined) seen.current.delete(oldest);
      }
      seen.current.add(id);
      seenOrder.current.push(id);
      fresh.push(id);
    }
    return fresh;
  }, []);

  const scheduleRetry = useCallback(() => {
    if (!alive.current || retryTimer.current) return;
    const delay = Math.min(BACKOFF_BASE * 2 ** backoffStep.current, BACKOFF_MAX);
    backoffStep.current = Math.min(backoffStep.current + 1, 5);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = 0;
      if (!alive.current) return;
      window.dispatchEvent(new Event("hg:binge-tick"));
    }, delay);
  }, []);

  /* 一轮取数：随机 2–3 页 → 合并 → 洗牌 → 去重 → append。返回是否拿到新内容 */
  const pull = useCallback(async (): Promise<boolean> => {
    if (loading.current) return false;
    /* 生长上限：正常情况下剩余不足 3 条才补；这里再兜一道，
       防止某些设备上滚动判定失灵时无限追加 section（真机出现过 77→100）。 */
    if (idsRef.current.length - indexRef.current > GROW_AHEAD_MAX) return false;
    loading.current = true;
    try {
      let fresh: number[] = [];
      for (let attempt = 0; attempt < 2 && !fresh.length; attempt++) {
        const count = PICK_MIN + Math.round(Math.random() * (PICK_MAX - PICK_MIN));
        const batch = await requestPages(pickPages(pages.current, count));
        if (!batch.ok) return false;
        if (batch.totalPages) pages.current = batch.totalPages;
        if (!batch.items.length) return false;
        fresh = takeFresh(shuffle(batch.items));
        /* 这一轮全站都刷过了：清空窗口重新洗牌，再取一次 */
        if (!fresh.length) { seen.current.clear(); seenOrder.current = []; }
      }
      if (!fresh.length) return false;
      setIds(prev => [...prev, ...fresh]);
      backoffStep.current = 0;
      return true;
    } finally {
      loading.current = false;
    }
  }, [requestPages, takeFresh]);

  /* 启动：第 1 页只为拿 total，再随机 2 页一起洗牌；失败就按退避重来，不空等 */
  const bootstrap = useCallback(async () => {
    const probe = await requestPages([1]);
    if (!alive.current) return;
    if (!probe.ok) {
      logLine(`[binge] bootstrap 取数失败，第 ${backoffStep.current + 1} 次退避重试`);
      if (backoffStep.current >= 2) setBootFailed(true);
      scheduleRetry();
      return;
    }
    pages.current = probe.totalPages;
    const extra = pages.current > 1 ? pickPages(pages.current, PICK_MIN) : [];
    const more = extra.length ? await requestPages(extra) : { items: [], totalPages: 0, ok: true };
    if (!alive.current) return;
    if (!pages.current && more.totalPages) pages.current = more.totalPages;
    const fresh = takeFresh(shuffle([...probe.items, ...more.items]));
    if (fresh.length) {
      logLine(`[binge] bootstrap ok，首批 ${fresh.length} 条`);
      setIds(fresh);
      setBooting(false);
      setBootFailed(false);
      backoffStep.current = 0;
    } else {
      scheduleRetry();
    }
  }, [requestPages, takeFresh, scheduleRetry]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  /* 退避到点：还没起来就重跑启动，已经起来了就只补尾巴 */
  useEffect(() => {
    const onTick = () => { if (booting) void bootstrap(); else void pull(); };
    window.addEventListener("hg:binge-tick", onTick);
    return () => window.removeEventListener("hg:binge-tick", onTick);
  }, [booting, bootstrap, pull]);

  /* 预取：剩余未播不足 3 条就立刻补，不等用户划到头 */
  useEffect(() => {
    if (booting || !ids.length) return;
    if (ids.length - index - 1 >= NEAR_END) return;
    void pull().then(ok => { if (!ok) scheduleRetry(); });
  }, [index, ids.length, booting, pull, scheduleRetry]);

  if (booting) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-black">
        <div className="flex flex-col items-center gap-3 px-8 text-center">
          <span className="text-[13px] text-white/70">
            {bootFailed ? "线路取不到片单，正在重试…" : "正在随机挑剧…"}
          </span>
          {bootFailed && (
            <>
              <span className="text-[12px] leading-relaxed text-white/45">
                可能是网络或线路问题。可以在「我的 · 网络」里换一条线路，或点下面重试。
              </span>
              <Button card className="hg-chip hg-ink-2 h-9 px-4 rounded-full text-[13px] font-semibold pressable"
                onClick={() => { setBootFailed(false); backoffStep.current = 0; void bootstrap(); }}>
                重试
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <EpisodePlayer videoIds={ids} startIndex={0} title={title} kind="video"
        mode="context" endless active={active} bottomInset={bottomInset} onBack={onBack}
        onNearEnd={() => { if (index >= ids.length - NEAR_END) void pull().then(ok => { if (!ok) scheduleRetry(); }); }}
        onActiveIndex={setIndex}
        /* 不感兴趣：播放器先跳到下一条，这里只负责把它记进本地黑名单（下次不再取） */
        onDislike={() => { void pull(); }} />
    </div>
  );
}
