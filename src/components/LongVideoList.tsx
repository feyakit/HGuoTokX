import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { VideoCard } from "../types";
import { Img, Empty } from "./ui";
import { Button } from "./ios/controls";
import { IGlobe, IPlayF } from "../icons";

const PAGE_SIZE = 20;

/** 秒 → 1:42:08 / 58:12；服务端 duration 是字符串秒数 */
function clock(seconds?: string | number): string {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "";
  const s = Math.floor(total % 60);
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function meta(v: VideoCard): string {
  const kind = (v.tags || [])[0] || "长片";
  const year = (v.created_at || "").slice(0, 4);
  return year ? `${kind} · ${year}` : kind;
}

/**
 * 长视频列表（16:9）：首屏 20 条，滑到底自动加载下一页；
 * 加载中出骨架，到底显示「没有更多了」，失败保留已加载内容并给一行重试。
 */
export default function LongVideoList({ active, onOpen }: { active: boolean; onOpen: (v: VideoCard) => void }) {
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const started = useRef(false);

  const load = useCallback(async (next: number) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await api.longVideos(next, PAGE_SIZE);
      const list = res?.items ?? [];
      setItems(prev => {
        const seen = new Set(prev.map(v => v.id));
        return [...prev, ...list.filter(v => v && !seen.has(v.id))];
      });
      setPage(next);
      setDone(!list.length || (res?.pagination ? next >= res.pagination.pages : list.length < PAGE_SIZE));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void load(1);
  }, [active, load]);

  /* 距底部 600px 内就往下一页要，滚动容器是这个 div 自己 */
  const onScroll = () => {
    const el = scroller.current;
    if (!el || busy.current || done || error) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) void load(page + 1);
  };

  return (
    <div ref={scroller} onScroll={onScroll} className="absolute inset-0 bg-bg scroll-y px-4 pb-24"
      style={{ paddingTop: "calc(var(--sat, 0px) + 56px)" }}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5">
        {items.map(v => (
          <button key={v.id} type="button" className="text-left pressable" onClick={() => onOpen(v)}>
            <span className="lg-card-art">
              <Img src={v.cover} alt="" />
              {clock(v.duration) && <span className="lg-card-dur"><IPlayF size={10} />{clock(v.duration)}</span>}
            </span>
            <span className="lg-card-title">{v.title}</span>
            <span className="lg-card-meta">{meta(v)}</span>
          </button>
        ))}

        {loading && [0, 1, 2, 3].map(index => (
          <div key={`s${index}`} aria-hidden="true">
            <div className="shimmer w-full rounded-[16px]" style={{ paddingTop: "56.25%" }} />
            <div className="shimmer mt-2 h-[13px] w-4/5 rounded-full" />
            <div className="shimmer mt-2 h-[11px] w-1/2 rounded-full" />
          </div>
        ))}
      </div>

      {!loading && error && (
        <div className="mt-5 flex flex-col items-center gap-2">
          <span className="text-[12px] text-dim">下一页加载失败：{error}</span>
          <Button className="px-4 text-primary" onClick={() => void load(page + 1)}>重试</Button>
        </div>
      )}

      {!loading && !error && done && items.length > 0 && (
        <p className="mt-6 text-center text-[12px] text-dim">没有更多了</p>
      )}

      {!loading && !error && !items.length && (
        <Empty icon={<IGlobe size={24} />} title="暂无长视频" sub="稍后再来看看" action="刷新" onAction={() => void load(1)} />
      )}

      {!loading && !error && !done && items.length > 0 && (
        <div className="mt-6 flex justify-center">
          <Button className="px-4 text-primary" onClick={() => void load(page + 1)}>加载更多</Button>
        </div>
      )}
    </div>
  );
}
