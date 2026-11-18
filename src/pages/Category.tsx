import { Button } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { VideoCard } from "../types";
import { useStore } from "../store";
import { Masonry } from "../components/cards";
import { useContentPreferences } from "../contentPreferences";
import { InplaceSearch } from "../components/InplaceSearch";
import { Empty, Img } from "../components/ui";
import { IBack, IGrid, ISearch } from "../icons";
import { TagsSection, TopicsSection } from "./Discover";

export const CHANNELS = [
  { cate: "ai-duanju", name: "AI成人短剧", desc: "高能反转 · 一口气看完" },
  { cate: "ai-manju", name: "AI成人漫剧", desc: "国创漫剧 · 每周更新" },
  { cate: "original", name: "原创", desc: "原创 · 独家好剧" },
] as const;

/* ================= 分类（片库） ================= */
/**
 * 分类页清晰两级筛选结构（全部页内切换，不跳离底栏）：
 * - 顶部：全局搜索栏（点击压入二级 Search 栈页）
 * - 第 1 层（胶囊 .hg-pill-row）：一级频道/视图（全部 / 短剧 / 漫剧 / 原创 / 专题 / 标签）
 * - 第 2 层（下划线 .hg-tab-ul）：当前频道专属排序或子类型（正交无重叠；专题/标签视图自动隐藏）
 */
const PRIMARY_VIEWS = [
  { key: "", label: "全部" },
  { key: "ai-duanju", label: "短剧" },
  { key: "ai-manju", label: "漫剧" },
  { key: "original", label: "原创" },
  { key: "topics", label: "专题" },
  { key: "tags", label: "标签" },
] as const;
type CategoryView = (typeof PRIMARY_VIEWS)[number]["key"];

const ALL_SORTS = [
  { key: "all", label: "综合推荐" },
  { key: "new", label: "最新上线" },
] as const;

const CHANNEL_SORTS = [
  { value: "latest", label: "最近更新" },
  { value: "hot_window", label: "当前热播" },
  { value: "random", label: "精选推荐" },
] as const;

const ORIGINAL_CATES = [
  { value: "all", label: "全部原创" },
  { value: "ai-duanju", label: "原创短剧" },
  { value: "ai-manju", label: "原创漫剧" },
] as const;

const originalSort = (cate: (typeof ORIGINAL_CATES)[number]["value"]) =>
  cate === "all" ? "new" : "latest";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const isNew = (v: VideoCard) => {
  const raw = v.created_at;
  if (!raw) return false;
  const t = Date.parse(raw.replace(" ", "T"));
  return Number.isFinite(t) && Date.now() - t < WEEK_MS;
};

export default function Category({ wide, active }: { wide: boolean; active: boolean }) {
  const { push, lineEpoch } = useStore();
  const [view, setView] = useState<CategoryView>("");
  const [allSort, setAllSort] = useState<(typeof ALL_SORTS)[number]["key"]>("all");
  const [chanSort, setChanSort] = useState<(typeof CHANNEL_SORTS)[number]["value"]>("latest");
  const [origCate, setOrigCate] = useState<(typeof ORIGINAL_CATES)[number]["value"]>("all");
  const [items, setItems] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const loadingRef = useRef(false);
  const seq = useRef(0);
  const loadedKey = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isCollectionView = view === "topics" || view === "tags";
  const subKey = view === "" ? allSort : view === "original" ? origCate : chanSort;

  const load = useCallback(async (p: number) => {
    if (isCollectionView || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setErr("");
    const my = ++seq.current;
    try {
      const res = view === "original"
        ? await api.originalVideos(origCate, p, 24, originalSort(origCate))
        : view === "ai-duanju" || view === "ai-manju"
          ? await api.category(view, p, 24, chanSort)
          : await api.feed(p, 24, allSort === "new" ? "new" : undefined);
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
  }, [view, allSort, chanSort, origCate, isCollectionView]);

  useEffect(() => {
    if (!active || isCollectionView) return;
    const key = `${view}|${subKey}|${lineEpoch}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    seq.current++;
    loadingRef.current = false;
    setItems([]);
    setDone(false);
    scrollRef.current?.scrollTo(0, 0);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, view, subKey, lineEpoch, isCollectionView]);

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <h1 className="sr-only">分类</h1>
      {/* 顶部搜索栏：点击压入全局搜索栈页，返回即回当前分类位置 */}
      <div className="shrink-0 hg-page-x pb-2 relative z-10" style={{ paddingTop: "calc(var(--sat, 0px) + 8px)" }}>
        <Button className="hg-searchbar" aria-label="搜索" onClick={() => push({ kind: "search", initialTab: "video" })}>
          <ISearch size={16} /><span>搜索短剧、演员、题材</span>
        </Button>
      </div>

      {/* 第 1 层：一级频道/视图胶囊（全部页内切换） */}
      <div className="shrink-0 hg-page-x relative z-10 mt-1">
        <div className="hg-pill-row" role="tablist" aria-label="频道分栏">
          {PRIMARY_VIEWS.map((item) => (
            <Button key={item.key || "all"} card role="tab" aria-selected={view === item.key}
              className="hg-pill"
              onClick={() => setView(item.key)}>{item.label}</Button>
          ))}
        </div>
      </div>

      {/* 第 2 层：当前频道专属二级排序/子分类（正交无重复；专题/标签不显示此行） */}
      {!isCollectionView && (
        <div className="shrink-0 hg-page-x pb-2 mt-1 flex gap-6 overflow-x-auto hg-chip-row relative z-10" role="tablist" aria-label="频道排序">
          {view === "" && ALL_SORTS.map(s => {
            const on = allSort === s.key;
            return (
              <Button key={s.key} role="tab" aria-selected={on}
                className={`hg-filter-text hg-tab-ul${on ? " is-on" : ""}`} data-on={String(on)}
                onClick={() => setAllSort(s.key)}>{s.label}</Button>
            );
          })}
          {(view === "ai-duanju" || view === "ai-manju") && CHANNEL_SORTS.map(s => {
            const on = chanSort === s.value;
            return (
              <Button key={s.value} role="tab" aria-selected={on}
                className={`hg-filter-text hg-tab-ul${on ? " is-on" : ""}`} data-on={String(on)}
                onClick={() => setChanSort(s.value)}>{s.label}</Button>
            );
          })}
          {view === "original" && ORIGINAL_CATES.map(s => {
            const on = origCate === s.value;
            return (
              <Button key={s.value} role="tab" aria-selected={on}
                className={`hg-filter-text hg-tab-ul${on ? " is-on" : ""}`} data-on={String(on)}
                onClick={() => setOrigCate(s.value)}>{s.label}</Button>
            );
          })}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: "calc(110px + var(--sab, 0px))" }}>
        {view === "topics" ? (
          <div className="pt-2"><TopicsSection wide={wide} /></div>
        ) : view === "tags" ? (
          <div className="pt-2"><TagsSection wide={wide} /></div>
        ) : (
          <>
            {err && (
              <div role="alert" className="py-4 flex flex-col items-center gap-2 text-[12px] text-danger">
                <span>{err}</span>
                <Button className="px-3 text-primary" onClick={() => void load(1)}>重试</Button>
              </div>
            )}
            {!items.length && loading && <div className="flex justify-center py-10"><Loader className="w-7 h-7 spinner" /></div>}
            {!items.length && !loading && !err && done && (
              <Empty icon={<IGrid size={26} />} title="暂无相关内容" sub="换个频道或排序试试" />
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
          </>
        )}
      </div>
    </div>
  );
}

/* ================= 频道详情页（二级路由兼容） ================= */
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
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <div className="shrink-0 relative z-10" style={{ paddingTop: "var(--sat, 0px)" }}>
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
            <Masonry videos={items} scopeKey={filterKey(serverSort, originalCate)} wide={wide} onOpen={(v) => { if (!replacing) push({ kind: "series", id: v.id }); }} />
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
      {searching && <InplaceSearch kind="video" scope={cate === "original" ? "original" : undefined} wide={wide} onClose={() => setSearching(false)} onOpenVideo={(v) => push({ kind: "series", id: v.id })} />}
    </div>
  );
}
