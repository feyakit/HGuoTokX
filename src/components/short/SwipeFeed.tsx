import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import VideoSurface, { type VideoHandle } from "../VideoSurface";
import { Button } from "../ios/controls";
import { useStore } from "../../store";
import { api, fmt, platform } from "../../api";
import { copyText } from "../../clipboard";
import { assignSlots, type AccentScheme } from "../../accent";
import { useAccent } from "../../useAccent";
import { installGlassQuality } from "../../glassQuality";
import { registerOverlayBack } from "../../back";
import { IBack, ICheck, IClose, IHeart, IHeartF, IShare, IStar, IStarF } from "../../icons";
import { haptic, mediaKey, networkProfile } from "./runtime";
import { invalidateMedia, loadMedia, type LoadedMedia } from "./media";

type FeedTab = "follow" | "recommend" | "rank";
type Item = { id: number; ep: number; key: string };
type Series = { id: number; ep: number; time?: number };

function asMedia(value: LoadedMedia | { error: string } | undefined): LoadedMedia | undefined {
  return value && "detail" in value ? value : undefined;
}

const TABS: { key: FeedTab; label: string }[] = [
  { key: "follow", label: "追剧" },
  { key: "recommend", label: "推荐" },
  { key: "rank", label: "榜单" },
];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const HOLD_MS = 380;

export default function SwipeFeed({
  variant = "discover", ids = [], videoId, startEp = 1, startTime, active, bottomInset = 0, onNearEnd, onBack,
}: {
  variant?: "discover" | "series";
  ids?: number[];
  videoId?: number;
  startEp?: number;
  startTime?: number;
  active: boolean;
  bottomInset?: number;
  onNearEnd?: () => void;
  onBack?: () => void;
}) {
  const store = useStore();
  const { favs, history, isLiked, isFav, setLiked, setCollected, addHistory, muted, setMuted, volume, setVolume, toast, preferHevc, lineEpoch, setFs } = store;
  const discover = variant === "discover";
  const net = useRef(networkProfile());
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const handles = useRef<(VideoHandle | null)[]>([null, null, null]);
  const [tab, setTab] = useState<FeedTab>("recommend");
  const [cursor, setCursor] = useState({ follow: 0, recommend: 0, rank: 0 });
  const [rankIds, setRankIds] = useState<number[]>([]);
  const [series, setSeries] = useState<Series | null>(discover ? null : { id: videoId || 0, ep: startEp, time: startTime });
  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [media, setMedia] = useState<Record<string, LoadedMedia | { error: string }>>({});
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const [boost, setBoost] = useState(false);
  const [locked, setLocked] = useState(false);
  const [dim, setDim] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [burst, setBurst] = useState<{ x: number; y: number; n: number } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [veil, setVeil] = useState(0);
  const [gesture, setGesture] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const applied = boost || locked ? 2 : rate;

  useEffect(() => installGlassQuality(platform), []);
  useEffect(() => {
    if (!discover) return;
    if (series && active) setFs(true);
    else setFs(false);
    return () => setFs(false);
  }, [discover, series, active, setFs]);

  useEffect(() => {
    if (tab !== "rank" || rankIds.length) return;
    let cancel = false;
    api.rank("hot").then(res => { if (!cancel) setRankIds((res.items || []).map(item => item.video_id)); }).catch(() => {});
    return () => { cancel = true; };
  }, [tab, rankIds.length, lineEpoch]);

  const list = useMemo<Item[]>(() => {
    if (!discover || series) return [];
    const source = tab === "follow" ? favs : tab === "rank" ? rankIds : ids;
    return source.map(id => {
      const saved = tab === "follow" ? history.find(row => row.id === id) : undefined;
      const ep = saved?.ep || 1;
      return { id, ep, key: mediaKey(id, ep) };
    });
  }, [discover, series, tab, favs, rankIds, ids, history]);

  const index = discover && !series ? Math.min(cursor[tab], Math.max(0, list.length - 1)) : 0;
  const currentItem: Item | null = series
    ? { id: series.id, ep: series.ep, key: mediaKey(series.id, series.ep) }
    : list[index] || null;
  const ready = asMedia(currentItem ? media[currentItem.key] : undefined);
  const episodeNums = useMemo(() => {
    if (ready) return ready.episodes;
    if (series) return [series.ep];
    return currentItem ? [currentItem.ep] : [];
  }, [ready, series, currentItem]);
  const seriesItems = useMemo<Item[]>(() => {
    if (!series) return [];
    return episodeNums.map(ep => ({ id: series.id, ep, key: mediaKey(series.id, ep) }));
  }, [series, episodeNums]);
  const items = series ? seriesItems : list;
  const itemIndex = series ? Math.max(0, items.findIndex(item => item.ep === series.ep)) : index;
  const wanted = useMemo(() => [-1, 0, 1].map(offset => items[itemIndex + offset]?.key || "").filter(Boolean), [items, itemIndex]);

  useEffect(() => {
    setSlots(prev => {
      const next = assignSlots(prev, wanted);
      return next.every((key, i) => key === prev[i]) ? prev : next;
    });
  }, [wanted]);

  useEffect(() => {
    let cancel = false;
    const profile = net.current;
    const queue = [...wanted];
    if (profile.prefetchAhead && items[itemIndex + 2]) queue.push(items[itemIndex + 2].key);
    for (const key of queue) {
      if (!key || mediaRef.current[key]) continue;
      const neighbor = key !== items[itemIndex]?.key;
      if (neighbor && !profile.preloadNext && !profile.prefetchAhead) continue;
      if (neighbor && !profile.preloadNext && key !== items[itemIndex + 2]?.key) continue;
      const [id, ep] = key.split(":").map(Number);
      loadMedia(id, ep, preferHevc, lineEpoch).then(data => {
        if (!cancel) setMedia(prev => ({ ...prev, [key]: data }));
      }).catch(error => {
        if (!cancel) setMedia(prev => ({ ...prev, [key]: { error: error instanceof Error ? error.message : "加载失败" } }));
      });
    }
    return () => { cancel = true; };
  }, [wanted, items, itemIndex, preferHevc, lineEpoch]);

  useEffect(() => {
    if (discover && !series && itemIndex >= items.length - 2) onNearEnd?.();
  }, [discover, series, itemIndex, items.length, onNearEnd]);

  const go = useCallback((dir: number) => {
    if (series) {
      const next = episodeNums[episodeNums.indexOf(series.ep) + dir];
      if (!next) { haptic("edge"); return; }
      setSeries({ id: series.id, ep: next });
      setCountdown(null);
      setFinished(false);
      haptic("tick");
      return;
    }
    setCursor(prev => {
      const next = prev[tab] + dir;
      if (next < 0 || next >= list.length) { haptic("edge"); return prev; }
      haptic("tick");
      return { ...prev, [tab]: next };
    });
  }, [series, episodeNums, tab, list.length]);

  const enterSeries = useCallback((id: number, ep: number, time?: number) => {
    setSeries({ id, ep, time });
    setCountdown(null);
    setFinished(false);
    setSheet(false);
    haptic("tick");
  }, []);

  const leaveSeries = useCallback(() => {
    if (!discover) { onBack?.(); return; }
    setSeries(null);
    setSheet(false);
    setCountdown(null);
    setFinished(false);
  }, [discover, onBack]);

  useEffect(() => {
    if (!active) return;
    return registerOverlayBack(() => {
      if (sheet) { setSheet(false); return true; }
      if (speedOpen) { setSpeedOpen(false); return true; }
      if (showGuide) { setShowGuide(false); return true; }
      if (discover && series) { leaveSeries(); return true; }
      return false;
    });
  }, [active, sheet, speedOpen, showGuide, discover, series, leaveSeries]);

  useEffect(() => {
    handles.current.forEach((handle, slot) => {
      if (!handle) return;
      handle.rate(applied);
      handle.mute(muted);
      handle.volume(volume);
      const mine = slots[slot] && slots[slot] === items[itemIndex]?.key;
      if (mine && active && !paused) handle.play();
      else handle.pause();
    });
  }, [slots, items, itemIndex, active, paused, applied, muted, volume, media]);

  useEffect(() => {
    if (paused || !active) { setDim(false); return; }
    setDim(false);
    const timer = window.setTimeout(() => setDim(true), 3000);
    return () => window.clearTimeout(timer);
  }, [paused, active, itemIndex, series, boost, locked, sheet]);

  const drag = useRef({ id: -1, x: 0, y: 0, t: 0, lastY: 0, lastT: 0, axis: "" as "" | "x" | "y" | "side", card: false, edge: false });
  const tap = useRef({ at: 0, x: 0, y: 0, timer: 0 });
  const holdTimer = useRef(0);

  const height = () => rootRef.current?.clientHeight || window.innerHeight;
  const resetTrack = (animate = false) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = "translate3d(0,0,0)";
  };
  const clearHold = () => { window.clearTimeout(holdTimer.current); if (!locked) setBoost(false); };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || sheet) return;
    const target = event.target as HTMLElement;
    // 点在按钮上就交给点击，不抢指针，否则 setPointerCapture 会把 click 吃掉。
    if (target.closest("button, a, input, [data-gesture=none]")) return;
    drag.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp,
      lastY: event.clientY, lastT: event.timeStamp, axis: "",
      card: !!target.closest("[data-gesture=card]"),
      edge: event.clientX - (rootRef.current?.getBoundingClientRect().left || 0) < 28,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDim(false);
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      setBoost(true);
      haptic("hold");
      try {
        if (!localStorage.getItem("hghubx_design_b_gesture_v1")) {
          localStorage.setItem("hghubx_design_b_gesture_v1", "1");
          setShowGuide(true);
        }
      } catch { /* ignore */ }
    }, HOLD_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.axis && Math.hypot(dx, dy) > 10) {
      const box = rootRef.current?.getBoundingClientRect();
      const landscape = !!box && box.width > box.height;
      const localX = box ? d.x - box.left : 0;
      if (landscape && Math.abs(dy) > Math.abs(dx) * 1.2 && box && (localX < box.width * 0.4 || localX > box.width * 0.6)) d.axis = "side";
      else d.axis = Math.abs(dy) > Math.abs(dx) * 1.2 ? "y" : "x";
      window.clearTimeout(holdTimer.current);
    }
    if (boost && !locked && d.y - event.clientY > 64) { setLocked(true); haptic("hold"); }
    if (d.axis === "side") {
      const box = rootRef.current?.getBoundingClientRect();
      const localX = box ? d.x - box.left : 0;
      const delta = (d.y - event.clientY) / Math.max(1, height());
      if (box && localX < box.width * 0.4) {
        setVeil(v => Math.min(0.72, Math.max(0, v - delta)));
        setGesture("亮度");
      } else {
        setVolume(Math.min(1, Math.max(0, volumeRef.current + delta)));
        setGesture("音量");
      }
      d.y = event.clientY;
      return;
    }
    if (d.axis !== "y" || !trackRef.current) return;
    const h = height();
    let y = dy;
    const atStart = itemIndex <= 0 && y > 0;
    const atEnd = itemIndex >= items.length - 1 && y < 0;
    if (atStart || atEnd) y = Math.max(-h * 0.12, Math.min(h * 0.12, y * 0.35));
    trackRef.current.style.transition = "none";
    trackRef.current.style.transform = `translate3d(0,${y}px,0)`;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d.id !== event.pointerId) return;
    drag.current.id = -1;
    window.clearTimeout(holdTimer.current);
    if (boost && !locked) setBoost(false);
    if (d.axis === "side") { setGesture(""); return; }
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    const dt = Math.max(1, event.timeStamp - d.t);
    const velocity = (event.clientY - d.lastY) / Math.max(1, event.timeStamp - d.lastT);
    if (d.axis === "x") {
      if (series && d.edge && dx > 48) leaveSeries();
      else if (discover && !series && (Math.abs(dx) > (rootRef.current?.clientWidth || 1) * 0.3 || Math.abs(dx) / dt > 0.4)) {
        const order = TABS.map(item => item.key);
        const next = order[order.indexOf(tab) + (dx < 0 ? 1 : -1)];
        if (next) { setTab(next); haptic("tick"); }
      }
      resetTrack(true);
      return;
    }
    if (d.axis === "y") {
      const h = height();
      const page = Math.abs(dy) > h * 0.18 || Math.abs(velocity) > 0.5;
      const dir = dy < 0 ? 1 : -1;
      if (page && items.length) {
        const el = trackRef.current;
        if (!el) { go(dir); return; }
        const can = (dir === 1 && itemIndex < items.length - 1) || (dir === -1 && itemIndex > 0);
        if (!can) { resetTrack(true); haptic("edge"); return; }
        el.style.transition = "transform 280ms cubic-bezier(.2,.8,.2,1)";
        el.style.transform = `translate3d(0,${dir === 1 ? -h : h}px,0)`;
        const done = () => { el.removeEventListener("transitionend", done); resetTrack(false); go(dir); };
        el.addEventListener("transitionend", done);
      } else if (d.card && dy < -64) {
        resetTrack(true);
        if (series) setSheet(true);
        else if (currentItem) {
          const saved = history.find(row => row.id === currentItem.id);
          enterSeries(currentItem.id, saved && (saved.ep > 1 || saved.t > 5) ? saved.ep : 1, saved?.t);
        }
      } else resetTrack(true);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input")) return;
    const now = event.timeStamp;
    if (now - tap.current.at < 260 && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) < 36) {
      window.clearTimeout(tap.current.timer);
      tap.current.at = 0;
      likeAt(event.clientX, event.clientY, true);
      return;
    }
    tap.current = { at: now, x: event.clientX, y: event.clientY, timer: window.setTimeout(() => setPaused(value => !value), 260) };
  };

  const likeAt = (x: number, y: number, forceOn: boolean) => {
    const item = items[itemIndex];
    if (!item) return;
    const box = rootRef.current?.getBoundingClientRect();
    setBurst({ x: x - (box?.left || 0), y: y - (box?.top || 0), n: Date.now() });
    const on = forceOn ? true : !isLiked(item.id, item.ep);
    if (forceOn && isLiked(item.id, item.ep)) { haptic("like"); return; }
    void setLiked("video", item.id, item.ep, on).catch(error => toast(error instanceof Error ? error.message : "点赞失败", "info"));
    haptic("like");
  };

  const onEnded = () => {
    const item = items[itemIndex];
    if (!item) return;
    addHistory(item.id, item.ep, 0, 1);
    const nums = asMedia(media[item.key])?.episodes || episodeNums;
    const next = nums.find(ep => ep > item.ep);
    if (next) setCountdown(next);
    else setFinished(true);
  };

  const countdownAction = useRef<() => void>(() => {});
  countdownAction.current = () => {
    const item = items[itemIndex];
    if (!item || countdown == null) return;
    if (series) setSeries({ id: series.id, ep: countdown });
    else enterSeries(item.id, countdown);
    setCountdown(null);
  };
  useEffect(() => {
    if (countdown == null) return;
    const timer = window.setTimeout(() => countdownAction.current(), 3000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const schemeStyle = (scheme: AccentScheme): CSSProperties => ({
    ["--accent" as string]: scheme.accent,
    ["--accent-2" as string]: scheme.second,
    ["--deep" as string]: scheme.deep,
    ["--tag" as string]: scheme.tag,
  });

  const currentScheme = useAccent(currentItem?.id, ready?.poster);

  return (
    <div ref={rootRef} className={`db-feed ${dim ? "is-dim" : ""} ${series ? "is-series" : ""}`} style={{ ...schemeStyle(currentScheme), paddingBottom: series ? 0 : bottomInset }}
      data-short-feed={discover ? "discover" : "series"}>
      {discover && !series && (
        <div className="db-top" data-gesture="none">
          {TABS.map(item => (
            <button key={item.key} type="button" className={tab === item.key ? "is-on" : ""} aria-pressed={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</button>
          ))}
          <i style={{ transform: `translateX(${TABS.findIndex(item => item.key === tab) * 100}%)` }} />
          <Button className="db-mute" aria-label={muted ? "取消静音" : "静音"} onClick={() => setMuted(value => !value)}>{muted ? "静音" : "有声"}</Button>
        </div>
      )}
      {(series || !discover) && (
        <div className="db-series-top" data-gesture="none">
          <Button aria-label="返回" className="db-icon" onClick={leaveSeries}><IBack size={22} /></Button>
          <span className="db-ep-label">{currentItem ? `第${currentItem.ep}集` : ""}</span>
          <Button className="db-speed" aria-label="倍速" aria-expanded={speedOpen} onClick={() => setSpeedOpen(value => !value)}>
            {applied === 2 && (boost || locked) ? "2.0x" : `${rate}x`}
          </Button>
        </div>
      )}
      {speedOpen && (
        <div className="db-speed-menu" role="menu" aria-label="播放速度" data-gesture="none">
          {SPEEDS.map(value => (
            <Button key={value} role="menuitemradio" aria-checked={rate === value} onClick={() => { setRate(value); setLocked(false); setBoost(false); setSpeedOpen(false); }}>{value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}x</Button>
          ))}
        </div>
      )}
      {(boost || locked) && <div className="db-boost" data-gesture="none">{locked ? "2.0x 已锁定" : "2.0x 倍速播放中"}{locked && <Button aria-label="关闭倍速锁定" onClick={() => setLocked(false)}><IClose size={14} /></Button>}</div>}

      {items.length === 0 ? (
        <div className="db-empty">
          <p>{tab === "follow" ? "还没有在追的剧" : tab === "rank" ? "榜单暂时没有内容" : "暂无视频"}</p>
          {tab === "follow" && <Button className="db-pill" onClick={() => setTab("recommend")}>去刷剧</Button>}
        </div>
      ) : (
        <div ref={trackRef} className="db-track" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer}>
          {slots.map((key, slot) => {
            const item = items.find(entry => entry.key === key);
            if (!item) return null;
            const offset = items.indexOf(item) - itemIndex;
            if (Math.abs(offset) > 1) return null;
            const loaded = asMedia(media[key]) || media[key];
            return (
              <Slide key={slot} slot={slot} offset={offset} item={item} loaded={loaded} active={active && offset === 0}
                preload={net.current.preloadNext} paused={paused} rate={applied} muted={muted} volume={volume}
                bottomInset={series ? 0 : bottomInset} series={!!series} interactive={offset === 0} liked={isLiked(item.id, item.ep)} faved={isFav(item.id)}
                continueEp={history.find(row => row.id === item.id)}
                veil={offset === 0 ? veil : 0}
                onHandle={handle => { handles.current[slot] = handle; }}
                onEnded={onEnded}
                onTime={(t, dur) => {
                  if (offset !== 0) return;
                  const now = performance.now();
                  if (now - (historyTick.current || 0) > 5000) {
                    historyTick.current = now;
                    addHistory(item.id, item.ep, t, dur);
                  }
                }}
                onOpenSeries={() => {
                  const saved = history.find(row => row.id === item.id);
                  enterSeries(item.id, saved && (saved.ep > 1 || saved.t > 5) ? saved.ep : 1, saved?.t);
                }}
                onLike={() => likeAt((rootRef.current?.clientWidth || 0) / 2, (rootRef.current?.clientHeight || 0) / 2, false)}
                onFav={() => { void setCollected("video", item.id, !isFav(item.id)).catch(error => toast(error instanceof Error ? error.message : "收藏失败", "info")); }}
                onShare={() => { const title = asMedia(media[key])?.detail.title || "这部剧"; void copyText(title).then(() => toast("已复制剧名", "ok")).catch(() => toast("复制失败", "info")); }}
                onSheet={() => setSheet(true)}
                onPick={ep => series ? setSeries({ id: series.id, ep }) : enterSeries(item.id, ep)}
                onRetry={() => { invalidateMedia(item.id, item.ep); setMedia(prev => { const next = { ...prev }; delete next[key]; return next; }); }}
              />
            );
          })}
        </div>
      )}

      {countdown != null && <CountDown ep={countdown} onCancel={() => setCountdown(null)} />}
      {finished && (
        <div className="db-countdown" data-gesture="none">
          <span>这集看完了</span>
          <Button onClick={() => { setFinished(false); if (discover && series) { leaveSeries(); setCursor(prev => ({ ...prev, [tab]: Math.min(list.length - 1, prev[tab] + 1) })); } else onBack?.(); }}>去看下一部</Button>
        </div>
      )}
      {burst && <HeartBurst key={burst.n} x={burst.x} y={burst.y} />}
      {showGuide && <GestureGuide onClose={() => setShowGuide(false)} />}
      {gesture && <div className="db-gesture-toast">{gesture}</div>}
      {sheet && currentItem && (
        <EpisodeSheet
          title={ready?.detail.title || "选集"}
          updated={episodeNums.length}
          episodes={episodeNums}
          current={currentItem.ep}
          onPick={ep => { if (series) setSeries({ id: currentItem.id, ep }); else enterSeries(currentItem.id, ep); setSheet(false); }}
          onClose={() => setSheet(false)}
        />
      )}
    </div>
  );
}

const historyTick = { current: 0 };

function CountDown({ ep, onCancel }: { ep: number; onCancel: () => void }) {
  const [left, setLeft] = useState(3);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(value => (value > 1 ? value - 1 : 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="db-countdown" data-gesture="none">
      <span>第{ep}集 {left} 秒后播放</span>
      <Button onClick={onCancel}>取消</Button>
    </div>
  );
}

function Slide({
  slot, offset, item, loaded, active, preload, paused, rate, muted, volume, bottomInset, series, interactive, liked, faved, continueEp, veil,
  onHandle, onEnded, onTime, onOpenSeries, onLike, onFav, onShare, onSheet, onPick, onRetry,
}: {
  slot: number; offset: number; item: Item; loaded?: LoadedMedia | { error: string }; active: boolean; preload: boolean;
  paused: boolean; rate: number; muted: boolean; volume: number; bottomInset: number; series: boolean; interactive: boolean;
  liked: boolean; faved: boolean; continueEp?: { ep: number; t: number }; veil: number;
  onHandle: (handle: VideoHandle | null) => void; onEnded: () => void; onTime: (t: number, dur: number) => void;
  onOpenSeries: () => void; onLike: () => void; onFav: () => void; onShare: () => void; onSheet: () => void;
  onPick: (ep: number) => void; onRetry: () => void;
}) {
  const data = loaded && "detail" in loaded ? loaded : undefined;
  const scheme = useAccent(item.id, data?.poster);
  const bar = useRef<HTMLInputElement>(null);
  const handleRef = useRef<VideoHandle | null>(null);
  const durationRef = useRef(0);
  const [slow, setSlow] = useState(false);
  const [framed, setFramed] = useState(false);
  useEffect(() => { setFramed(false); const timer = window.setTimeout(() => setSlow(true), 600); return () => window.clearTimeout(timer); }, [item.key]);
  const title = data?.detail.title || (loaded && "error" in loaded ? "加载失败" : "正在打开");
  const tags = data?.detail.tags?.slice(0, 2) || [];
  const total = data?.episodes.length || data?.detail.episode_count || 1;
  const resume = continueEp && (continueEp.ep > 1 || continueEp.t > 5);
  const watchLabel = resume ? `继续看第 ${continueEp.ep} 集` : "看全集";
  return (
    <section className={`db-slide ${framed ? "is-framed" : ""}`} style={{ transform: `translate3d(0,${offset * 100}%,0)`, ["--accent" as string]: scheme.accent, ["--accent-2" as string]: scheme.second, ["--deep" as string]: scheme.deep, ["--tag" as string]: scheme.tag }}>
      {data?.poster && <img className={`db-poster ${framed ? "is-gone" : ""}`} src={data.poster} alt="" />}
      {data?.url && (
        <VideoSurface ref={handle => { handleRef.current = handle; onHandle(handle); }} src={data.url} poster={data.poster} active={active || preload} autoPlay={active && !paused}
          muted={muted} volume={volume} rate={rate} fit="cover" className="db-video"
          maxBufferLength={networkProfile().buffer} maxMaxBufferLength={networkProfile().buffer}
          onPlaying={() => { if ((handleRef.current?.el()?.videoWidth || 0) > 0) setFramed(true); }} onEnded={() => { if (active) onEnded(); }}
          onTime={t => {
            const duration = durationRef.current;
            const el = bar.current;
            if (el && duration > 0 && document.activeElement !== el) {
              el.value = String(t);
              el.style.setProperty("--fill", `${(t / duration) * 100}%`);
            }
            if (active) onTime(t, duration);
          }}
          onDuration={d => { durationRef.current = d || 0; if (bar.current) bar.current.max = String(d || 0); }}
        />
      )}
      {veil > 0 && <div className="db-veil" style={{ opacity: veil }} />}
      {!data?.url && slow && <div className="db-status">{loaded && !("detail" in loaded) ? loaded.error : (data?.error || "正在缓冲")}{(loaded && !("detail" in loaded)) || data?.error ? <Button onClick={onRetry}>重试</Button> : null}</div>}
      <div className={`db-shade ${series ? "is-card" : ""} ${interactive ? "" : "is-preview"} ${framed ? "is-framed" : ""}`} style={{ paddingBottom: bottomInset + (series ? 18 : 8) }}>
        <div className="db-info" data-gesture="card">
          <button type="button" className="db-title" onClick={series ? onSheet : onOpenSeries}>{title}</button>
          {!!tags.length && <div className="db-tags">{tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
          <p className="db-meta">第{item.ep}集 · 全{total}集</p>
          {!series && interactive && <Button className="db-watch" onClick={onOpenSeries}>{watchLabel} ›</Button>}
          {series && data && interactive && (
            <div className="db-strip" data-gesture="none">
              <div className="db-strip-row">
                {data.episodes.slice(Math.max(0, item.ep - 3), Math.max(5, item.ep + 2)).map(ep => (
                  <button key={ep} type="button" className={ep === item.ep ? "is-on" : ""} onClick={() => onPick(ep)}>{ep}</button>
                ))}
              </div>
              <Button className="db-more" onClick={onSheet}>选集 全{total}集 ›</Button>
            </div>
          )}
          {interactive && (
            <label className="db-progress">
              <span className="sr-only">播放进度</span>
              <input ref={bar} data-gesture="none" aria-label="播放进度" type="range" min={0} max={0} step={0.1} defaultValue={0}
                onChange={event => {
                  const input = event.target;
                  input.style.setProperty("--fill", `${input.max === "0" ? 0 : (Number(input.value) / Number(input.max)) * 100}%`);
                }}
                onPointerUp={event => {
                  const input = event.currentTarget;
                  const surface = input.closest(".db-slide")?.querySelector("video");
                  if (surface) surface.currentTime = Number(input.value);
                }} />
            </label>
          )}
        </div>
        {interactive && <div className="db-rail" data-gesture="none">
          <Button aria-label={liked ? "取消喜欢" : "喜欢"} onClick={onLike}><i className={liked ? "is-like" : ""}>{liked ? <IHeartF size={30} /> : <IHeart size={30} />}</i><span>{fmt(data?.detail.counts.like)}</span></Button>
          <Button aria-label={faved ? "取消收藏" : "收藏"} onClick={onFav}><i className={faved ? "is-fav" : ""}>{faved ? <IStarF size={28} /> : <IStar size={28} />}</i><span>{fmt(data?.detail.counts.collect)}</span></Button>
          <Button aria-label="分享" onClick={onShare}><IShare size={28} /><span>分享</span></Button>
        </div>}
      </div>
    </section>
  );
}

function EpisodeSheet({ title, updated, episodes, current, onPick, onClose }: {
  title: string; updated: number; episodes: number[]; current: number; onPick: (ep: number) => void; onClose: () => void;
}) {
  const size = 30;
  const groups = Math.max(1, Math.ceil(episodes.length / size));
  const [group, setGroup] = useState(Math.floor((current - 1) / size));
  const slice = episodes.slice(group * size, group * size + size);
  return (
    <div className="db-sheet-root" role="dialog" aria-label="选集" data-gesture="none">
      <button type="button" className="db-sheet-mask" aria-label="关闭选集" onClick={onClose} />
      <div className="db-sheet">
        <div className="db-sheet-handle" />
        <div className="db-sheet-head">
          <div>
            <h2>{title}</h2>
            <p>已更新至{updated}集</p>
          </div>
          <Button aria-label="关闭" className="db-icon" onClick={onClose}><IClose size={18} /></Button>
        </div>
        <div className="db-groups">
          {Array.from({ length: groups }, (_, index) => (
            <button key={index} type="button" className={group === index ? "is-on" : ""} onClick={() => setGroup(index)}>
              {index * size + 1}-{Math.min(episodes.length, (index + 1) * size)}
            </button>
          ))}
        </div>
        <div className="db-grid">
          {slice.map(ep => (
            <button key={ep} type="button" className={ep === current ? "is-on" : ""} onClick={() => onPick(ep)}>
              {ep === current ? <i /> : null}
              {ep < current && <ICheck size={12} />}
              <b>{ep}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HeartBurst({ x, y }: { x: number; y: number }) {
  return <div className="db-burst" style={{ left: x, top: y }}><IHeartF size={72} /></div>;
}

function GestureGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="db-guide" data-gesture="none" onClick={onClose}>
      <div><b>左侧上下滑</b><span>调亮度</span></div>
      <div><b>长按 2 倍速</b><span>上滑锁定</span></div>
      <div><b>右侧上下滑</b><span>调音量</span></div>
      <p>横屏才调节亮度和音量，点一下关掉</p>
    </div>
  );
}
