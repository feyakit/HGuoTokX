import { Button } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { Post, TagGroup, VideoCard } from "../types";
import { useStore } from "../store";
import { MediaCard, Masonry, RowCard } from "../components/cards";
import { FilteredContent } from "../components/FilteredContent";
import { useContentPreferences } from "../contentPreferences";
import { CollectionLink, CollectionLinks } from "../components/CollectionLink";
import { InplaceSearch } from "../components/InplaceSearch";
import { Empty, Img } from "../components/ui";
import { IBack, IChevR, IGlobe, IGrid, ISearch, ITrophy } from "../icons";

export const CHANNELS = [
  { cate: "ai-duanju", name: "AI成人短剧", desc: "高能反转 · 一口气看完" },
  { cate: "ai-manju", name: "AI成人漫剧", desc: "国创漫剧 · 每周更新" },
  { cate: "original", name: "原创", desc: "原创 · 独家好剧" },
] as const;

/* ================= 分类（片库） ================= */
/**
 * 图三第 2 屏：顶搜索框 → 一级 tab（题材）→ 二级类型 chips → 3 列网格。
 * 角标只用真实数据：New = created_at 在 7 天内；Hot 需要 is_hot 字段，接口没给 → 不画（不编）。
 * 播放量用 hot 字段真值。
 */
const SUB_TABS = [
  { cate: "", name: "综合" },
  { cate: "ai-duanju", name: "短剧" },
  { cate: "ai-manju", name: "漫剧" },
  { cate: "original", name: "原创" },
] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const isNew = (v: VideoCard) => {
  const raw = v.created_at;
  if (!raw) return false;
  const t = Date.parse(raw.replace(" ", "T"));
  return Number.isFinite(t) && Date.now() - t < WEEK_MS;
};

export default function Category({ wide, active }: { wide: boolean; active: boolean }) {
  const { push, lineEpoch, setTab } = useStore();
  const [cate, setCate] = useState<string>("");
  const [primary, setPrimary] = useState<"all" | "new">("all");
  /* 二级 chips：用站点真实标签（api.tags 的第一个分组），选中的标签走 api.tagVideos 真筛选 */
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState<string>("");
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const loadingRef = useRef(false);
  const seq = useRef(0);
  const tagsLoaded = useRef(false);      /* 二级 chips 只统计一次，切 tab 回来不重复打 3 页 */
  const loadedKey = useRef("");          /* 当前网格数据对应的「题材|标签|线路」组合 */

  useEffect(() => {
    if (!active || tagsLoaded.current) return;
    tagsLoaded.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const pages = await Promise.all([1, 2, 3].map(p => api.feed(p, 30)));
        if (cancelled) return;
        const freq = new Map<string, number>();
        for (const res of pages) {
          for (const v of res?.items ?? []) {
            for (const tag of v.tags ?? []) freq.set(tag, (freq.get(tag) ?? 0) + 1);
          }
        }
        const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
        setTags(top);
      } catch {
        if (!cancelled) setTags([]);
      }
    })();
    return () => { cancelled = true; };
  }, [lineEpoch, active]);

  const load = useCallback(async (p: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setErr("");
    const my = ++seq.current;
    try {
      const sort = primary === "new" ? "new" : undefined;
      const res = tag
        ? await api.tagVideos(tag, p, 24)
        : cate === "original"
          ? await api.originalVideos("all", p, 24, "new")
          : cate
            ? await api.category(cate, p, 24)
            : await api.feed(p, 24, sort);
      if (my !== seq.current) return;
      const rows = (res?.items ?? []).filter(v => v && v.cover);
      setItems(prev => p === 1 ? rows : [...prev, ...rows.filter(r => !prev.some(x => x.id === r.id))]);
      setPage(p);
      setDone(!rows.length || !!(res?.pagination && p >= (res.pagination.pages || 1)));
    } catch (e) {
      if (my === seq.current) setErr((e as Error)?.message || "加载失败");
    } finally {
      if (my === seq.current) { setLoading(false); loadingRef.current = false; }
    }
  }, [cate, tag, primary]);

  useEffect(() => {
    if (!active) return;
    const key = `${primary}|${cate}|${tag}|${lineEpoch}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    setItems([]); setDone(false);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, primary, cate, tag, lineEpoch]);

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <h1 className="sr-only">分类</h1>
      {/* 顶部搜索框：高 44、全圆角、#1E1E2E、Please enter… */}
      <div className="shrink-0 hg-page-x pb-2 relative z-10" style={{ paddingTop: "calc(var(--sat, 0px) + 8px)" }}>
        <Button className="hg-searchbar" aria-label="搜索" onClick={() => setTab("search")}>
          <ISearch size={16} /><span>搜索短剧、演员、题材</span>
        </Button>
      </div>

      {/* 顶栏第 2 层：胶囊 tab（全部 / 最新 / 榜单 / 专题 / 标签） */}
      <div className="shrink-0 hg-page-x relative z-10 mt-1">
        <div className="hg-pill-row" role="tablist" aria-label="频道分栏">
          <Button card role="tab" aria-selected={primary === "all"} className="hg-pill"
            onClick={() => setPrimary("all")}>全部</Button>
          <Button card role="tab" aria-selected={primary === "new"} className="hg-pill"
            onClick={() => setPrimary("new")}>最新</Button>
          <Button card role="tab" aria-selected={false} className="hg-pill"
            onClick={() => push({ kind: "ranks" })}>榜单</Button>
          <Button card role="tab" aria-selected={false} className="hg-pill"
            onClick={() => push({ kind: "topics" })}>专题</Button>
          <Button card role="tab" aria-selected={false} className="hg-pill"
            onClick={() => push({ kind: "tags" })}>标签</Button>
        </div>
      </div>

      {/* 顶栏第 3 层：二级分类行（白字加粗 + 底部 3px 紫下划线） */}
      <div className="shrink-0 hg-page-x pb-2 mt-1 flex gap-6 overflow-x-auto hg-chip-row relative z-10">
        {SUB_TABS.map(t => {
          const on = !tag && cate === t.cate;
          return (
            <Button key={t.cate} className={`hg-filter-text hg-tab-ul${on ? " is-on" : ""}`}
              aria-pressed={on} data-on={String(on)}
              onClick={() => { setTag(""); setCate(t.cate); }}>{t.name}</Button>
          );
        })}
        {tags.map(t => {
          const on = tag === t;
          return (
            <Button key={t} className={`hg-filter-text hg-tab-ul${on ? " is-on" : ""}`}
              aria-pressed={on} data-on={String(on)}
              onClick={() => setTag(on ? "" : t)}>{t}</Button>
          );
        })}
      </div>

      <div className="flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: "calc(110px + var(--sab, 0px))" }}>
        {err && (
          <div role="alert" className="py-4 flex flex-col items-center gap-2 text-[12px] text-danger">
            <span>{err}</span>
            <Button className="px-3 text-primary" onClick={() => void load(1)}>重试</Button>
          </div>
        )}
        {!items.length && loading && <div className="flex justify-center py-10"><Loader className="w-7 h-7 spinner" /></div>}
        {!items.length && !loading && !err && done && (
          <Empty icon={<IGrid size={26} />} title="暂无相关内容" sub="换个分类或标签试试" />
        )}

        <div className="hg-grid-c3 mt-1">
          {items.map(v => (
            <Button key={v.id} className="hg-poster is-c3" onClick={() => push({ kind: "series", id: v.id })}>
              <span className="hg-poster-art">
                <Img src={v.cover} alt="" />
                <span className="hg-poster-veil" aria-hidden="true" />
                {v.is_hot === 1
                  ? <span className="hg-poster-badge is-hot">热门</span>
                  : isNew(v) ? <span className="hg-poster-badge">上新</span> : null}
                <span className="hg-poster-views">▶ {fmt(v.hot)}</span>
              </span>
              <span className="hg-poster-name">{v.title}</span>
              <span className="hg-poster-meta">{v.tags?.[0] || "短剧"}</span>
            </Button>
          ))}
        </div>

        {items.length > 0 && !done && (
          <Button className="hg-loadmore" onClick={() => void load(page + 1)} disabled={loading}>
            {loading ? "加载中…" : "加载更多"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ================= 频道详情页 ================= */
const CHANNEL_SORTS = [
  { value: "latest", label: "最近更新" },
  { value: "hot_window", label: "当前热播" },
  { value: "random", label: "精选推荐" },
] as const;

const ORIGINAL_CATES = [
  { value: "all", label: "全部原创" },
  { value: "ai-manju", label: "原创漫剧" },
  { value: "ai-duanju", label: "原创短剧" },
] as const;

const originalSort = (cate: (typeof ORIGINAL_CATES)[number]["value"]) =>
  cate === "all" ? "new" : "latest";

export function ChannelPage({ cate, name, onBack, wide }: { cate: string; name: string; onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  const { preferences } = useContentPreferences();
  const filtering = !preferences.paused && (preferences.blockedTags.length > 0 || preferences.hideUntagged);
  const [searching, setSearching] = useState(false);
  const [serverSort, setServerSort] = useState<(typeof CHANNEL_SORTS)[number]["value"]>("latest");
  const [originalCate, setOriginalCate] = useState<(typeof ORIGINAL_CATES)[number]["value"]>("all");
  const [pageItems, setPageItems] = useState<VideoCard[][]>([]);
  const items = pageItems.flat();
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const filterKey = (sort: string, original: string) => `${cate}:${cate === "original" ? original : sort}`;
  const [displayedFilter, setDisplayedFilter] = useState(() => filterKey("latest", "all"));
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(false);
  const requestSeq = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const scrollContainer = useRef<HTMLDivElement>(null);

  const loadMore = async (reset = false, sortOverride: string = serverSort, originalCateOverride = originalCate) => {
    const seq = reset ? ++requestSeq.current : requestSeq.current;
    if (!reset && (busy.current || page >= pages)) return;
    busy.current = true;
    setLoading(true);
    setErr(null);
    if (reset) setRefreshing(true);
    try {
      const next = reset ? 1 : page + 1;
      const res = cate === "original"
        ? await api.originalVideos(originalCateOverride, next, 20, originalSort(originalCateOverride))
        : await api.category(cate, next, 20, sortOverride);
      if (seq !== requestSeq.current) return;
      setPageItems((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.flat().map((x) => x.id));
        return [...base, (res?.items || []).filter((x) => !seen.has(x.id))];
      });
      setDisplayedFilter(filterKey(sortOverride, originalCateOverride));
      setPage(next);
      setPages(res?.pagination?.pages || next);
      setErr(null);
    } catch (e) {
      if (seq === requestSeq.current) setErr((e as Error).message || "加载失败");
    } finally {
      if (seq === requestSeq.current) {
        busy.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const changeServerSort = (value: (typeof CHANNEL_SORTS)[number]["value"]) => {
    if (value === serverSort) return;
    if (scrollContainer.current) scrollContainer.current.scrollTop = 0;
    setServerSort(value);
    setErr(null);
    void loadMore(true, value);
  };

  const changeOriginalCate = (value: (typeof ORIGINAL_CATES)[number]["value"]) => {
    if (value === originalCate) return;
    if (scrollContainer.current) scrollContainer.current.scrollTop = 0;
    setOriginalCate(value);
    setErr(null);
    void loadMore(true, originalSort(value), value);
  };

  useEffect(() => {
    setPageItems([]); setPage(0); setPages(1);
    setServerSort("latest"); setOriginalCate("all"); setSearching(false);
    void loadMore(true, "latest", "all");
    return () => { requestSeq.current++; busy.current = false; };
    /* eslint-disable-next-line */
  }, [cate]);
  const filterPending = displayedFilter !== filterKey(serverSort, originalCate);
  const replacing = refreshing || filterPending;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || filtering || loading || err || replacing || page >= pages) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) void loadMore(); }, { root: scrollContainer.current, rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages, loading, err, replacing, filtering]);

  return (
    <div className="ios-page absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="px-3 pt-2 pb-3 flex items-center gap-2.5">
          <Button aria-label="返回" onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></Button>
          <span className="w-[40px] h-[40px] rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><IGrid size={21} strokeWidth={1.9} /></span>
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-on leading-tight">{name}</h1>
            <div role="status" className="text-[12px] text-mut">{replacing ? (loading ? "正在更新筛选结果…" : "筛选更新失败") : `已加载 ${items.length} 部 · ${page}/${Math.max(pages, 1)} 页`}</div>
          </div>
          <Button onClick={() => setSearching(true)} aria-label={cate === "original" ? "搜索原创" : "搜索短剧"} className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><ISearch size={19} /></Button>
        </div>
        {cate === "original" && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {ORIGINAL_CATES.map((s) => (
              <Button aria-pressed={originalCate === s.value} key={s.value} onClick={() => changeOriginalCate(s.value)}
                className="ios-filter-pill">{s.label}</Button>
            ))}
          </div>
        )}
        {cate !== "original" && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {CHANNEL_SORTS.map((s) => (
              <Button aria-pressed={serverSort === s.value} key={s.value} onClick={() => changeServerSort(s.value)}
                className="ios-filter-pill">{s.label}</Button>
            ))}
          </div>
        )}
      </div>
      <div ref={scrollContainer} className="flex-1 scroll-y px-4 pt-3 pb-8" aria-busy={loading}>
        {items.length > 0 && replacing && <p role="status" className="mb-3 text-[12px] text-mut">{loading ? "正在更新，暂时保留上次结果…" : "当前显示上次结果，请重试以更新筛选。"}</p>}
        {items.length > 0 && err && <div role="status" className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-mut"><span>{err}</span><Button className="px-3 text-primary" onClick={() => void loadMore(replacing)}>重试</Button></div>}
        {items.length ? (
          <div inert={replacing || undefined} className={replacing ? "opacity-60" : undefined}>
            <Masonry videos={items} scopeKey={filterKey(serverSort, originalCate)} wide={wide} onOpen={(v) => { if (!replacing) push({ kind: "feed", videoIds: items.map((x) => x.id), index: items.findIndex((x) => x.id === v.id), title: name }); }} />
          </div>
        ) : err ? (
          <Empty icon={<IGrid size={26} />} title="加载失败" sub={err} action="重试" onAction={() => void loadMore(true)} />
        ) : loading ? (
          <div className="flex justify-center py-10"><Loader className="w-8 h-8 spinner" /></div>
        ) : <Empty icon={<IGrid size={26} />} title="该筛选下暂无内容" sub="换个筛选试试" />}
        <div ref={sentinel} className="h-10" />
        {loading && items.length > 0 && <div className="flex justify-center py-3"><Loader className="w-6 h-6 spinner" /></div>}
        {!loading && !err && !replacing && page < pages && <Button onClick={() => void loadMore()} className="my-3 px-4 text-primary">加载更多</Button>}
        {!loading && !replacing && !err && page >= pages && items.length > 0 && (
          <div className="text-center text-[12px] text-dim py-3">— 已经到底啦 —</div>
        )}
      </div>
      {searching && <InplaceSearch kind="video" scope={cate === "original" ? "original" : undefined} wide={wide} onClose={() => setSearching(false)} onOpenVideo={(v, list) => push({ kind: "feed", videoIds: list.map((x) => x.id), index: list.findIndex((x) => x.id === v.id), title: `搜索 · ${name}` })} />}
    </div>
  );
}
