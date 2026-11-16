import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ios/controls";
import { api, cover, fmtTime } from "../api";
import type { Detail } from "../types";
import { useStore } from "../store";
import { ambientStyle, useAccent, useAmbient } from "../useAccent";
import { Empty } from "../components/ui";
import { IPlayF, IStar } from "../icons";

/** 底部「追剧」是列表：继续看、在追和历史。播放仍进剧内连播。 */
export default function Follow({ active }: { active: boolean; wide?: boolean }) {
  const { favs, history, setTab, push } = useStore();
  const [cache, setCache] = useState<Record<number, Detail>>({});
  const ids = [...new Set([...favs, ...history.map(item => item.id)])];
  const idKey = ids.join(",");
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  useEffect(() => {
    if (!active || !idKey) return;
    const missing = idKey.split(",").map(Number).filter(id => !cacheRef.current[id]);
    if (!missing.length) return;
    let cancel = false;
    Promise.allSettled(missing.map(id => api.video(id))).then(results => {
      if (cancel) return;
      const next: Record<number, Detail> = {};
      results.forEach((result, index) => { if (result.status === "fulfilled") next[missing[index]] = result.value; });
      if (Object.keys(next).length) setCache(prev => ({ ...prev, ...next }));
    });
    return () => { cancel = true; };
  }, [active, idKey]);
  const [segment, setSegment] = useState<"follow" | "history">("follow");
  const ambient = useAmbient();
  const latest = history[0];
  const latestDetail = latest ? cache[latest.id] : undefined;
  const list = segment === "follow" ? favs : history.map(item => item.id);
  const open = (id: number, ep?: number, time?: number) => {
    const detail = cache[id];
    push({ kind: "series", videoId: id, startEp: ep, startTime: time, title: detail?.title || "追剧" });
  };
  return (
    <div className="ios-page db-follow absolute inset-0 flex flex-col" style={ambientStyle(ambient)}>
      <div className="ios-page-heading shrink-0 px-4"><h1 className="ios-page-title">追剧</h1></div>
      <div className="flex-1 scroll-y px-4" style={{ paddingBottom: "calc(128px + var(--sab, 16px))" }}>
        {latestDetail && latest && (
          <>
            <button type="button" className="db-kicker" onClick={() => open(latest.id, latest.ep, latest.t)}>继续观看 ›</button>
            <Continue card={latestDetail} ep={latest.ep} time={latest.t} onOpen={() => open(latest.id, latest.ep, latest.t)} />
          </>
        )}
        <div className="db-seg" role="tablist" aria-label="追剧内容">
          <button type="button" className={segment === "follow" ? "is-on" : ""} aria-pressed={segment === "follow"} onClick={() => setSegment("follow")}>在追</button>
          <button type="button" className={segment === "history" ? "is-on" : ""} aria-pressed={segment === "history"} onClick={() => setSegment("history")}>观看历史</button>
        </div>
        {list.length === 0 && <Empty icon={<IStar size={24} />} title={segment === "follow" ? "还没有在追的剧" : "还没有观看记录"} sub="喜欢的剧会出现在这里" action="去刷剧" onAction={() => setTab("home")} />}
        <div className="mt-2">
          {list.map(id => {
            const card = cache[id];
            const progress = history.find(item => item.id === id);
            if (!card) return null;
            const fresh = progress ? card.episode_count > progress.ep : false;
            return <FollowRow key={id} card={card} progress={progress} fresh={fresh} onOpen={() => open(id, progress?.ep, progress?.t)} />;
          })}
        </div>
      </div>
    </div>
  );
}

function Continue({ card, ep, time, onOpen }: { card: Detail; ep: number; time: number; onOpen: () => void }) {
  const scheme = useAccent(card.id, cover(card.cover));
  const remain = card.duration && card.duration > time ? card.duration - time : 0;
  const ratio = card.duration ? Math.min(100, (time / card.duration) * 100) : 8;
  return (
    <button type="button" className="db-continue" onClick={onOpen} style={{ ["--accent" as string]: scheme.accent, ["--accent-2" as string]: scheme.second }}>
      <img src={cover(card.cover)} alt="" />
      <span>
        <b>{card.title}</b>
        <span>看到第{ep}集{remain > 0 ? ` · 剩余${fmtTime(remain)}` : ""}</span>
        <u><i style={{ width: `${ratio}%` }} /></u>
      </span>
      <i className="db-play" aria-hidden="true"><IPlayF size={14} /></i>
    </button>
  );
}

function FollowRow({ card, progress, fresh, onOpen }: { card: Detail; progress?: { ep: number; t: number }; fresh: boolean; onOpen: () => void }) {
  const scheme = useAccent(card.id, cover(card.cover));
  return (
    <button type="button" className="db-row" onClick={onOpen} style={{ ["--accent" as string]: scheme.accent, ["--accent-2" as string]: scheme.second }}>
      <img src={cover(card.cover)} alt="" />
      <span>
        <b>{card.title}</b>
        <span className="db-meta">{progress ? `更新至${card.episode_count}集 · 看到${progress.ep}集` : `${card.episode_count}集`}{fresh ? <em className="db-fresh">更新</em> : null}</span>
        <s className="db-bar"><i style={{ width: progress ? "46%" : "12%" }} /></s>
      </span>
    </button>
  );
}
