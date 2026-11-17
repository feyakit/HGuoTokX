import { Button } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { Post, VideoCard } from "../types";
import { useStore } from "../store";
import { MediaCard, Masonry } from "../components/cards";
import { FilteredContent } from "../components/FilteredContent";
import { useContentPreferences } from "../contentPreferences";
import { CollectionLink, CollectionLinks } from "../components/CollectionLink";
import { InplaceSearch } from "../components/InplaceSearch";
import { Empty, Img } from "../components/ui";
import { IBack, IChevR, IGlobe, IGrid, ISearch, ITrophy } from "../icons";
import { siteChannels, siteSorts, FALLBACK_CHANNELS, type ChannelEntry } from "../siteCatalog";


/* ================= 分类第一层：题材广场 ================= */
/** 每个题材取一张代表封面 + 总数，做 2 列大卡；点进去是该题材的频道页。 */
type CoverMeta = { cover: string; count: number; offline?: boolean };

export default function Category({ wide, active }: { wide: boolean; active: boolean }) {
  const { push, lineEpoch, setTab } = useStore();
  const [channels, setChannels] = useState<ChannelEntry[]>(FALLBACK_CHANNELS);
  const [sorts, setSorts] = useState<ChannelEntry[]>([]);
  const [sort, setSort] = useState<string>("");
  const [metas, setMetas] = useState<Record<string, CoverMeta>>({});
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, sortList] = await Promise.all([siteChannels(), siteSorts()]);
      if (cancelled) return;
      setChannels(list.length ? list : FALLBACK_CHANNELS);
      setSorts(sortList);
    })();
    return () => { cancelled = true; };
  }, [lineEpoch]);

  /* 封面随快筛变化：换排序就重取每个题材的第一部，顺带拿到总数 */
  useEffect(() => {
    if (!active && Object.keys(metas).length) return;
    const my = ++seq.current;
    setLoading(true);
    setErr("");
    void (async () => {
      const next: Record<string, CoverMeta> = {};
      await Promise.all(channels.map(async (c) => {
        try {
          const res = c.cate === "original"
            ? await api.originalVideos("all", 1, 1, sort || "new")
            : await api.category(c.cate, 1, 1, sort || undefined);
          const first = res?.items?.[0];
          next[c.cate] = first
            ? { cover: first.cover, count: res?.pagination?.total ?? 0 }
            : { cover: "", count: 0 };
        } catch { /* 单个题材失败不影响整体：标记该题材不可用，卡片照常占位 */ next[c.cate] = { cover: "", count: 0, offline: true }; }
      }));
      if (my !== seq.current) return;
      setMetas(next);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, sort, active, lineEpoch]);

  return (
    <div className="ios-page ios-tint-12 absolute inset-0 bg-bg flex flex-col">
      <div className="ios-page-heading shrink-0 px-4 pb-1">
        <h1 className="ios-page-title">分类</h1>
        <p className="text-[12px] text-mut mt-0.5">{channels.length} 个题材 · 每周持续上新</p>
      </div>

      <div className="shrink-0 px-4 pb-3 flex flex-wrap gap-2">
        <Button aria-pressed={!sort} onClick={() => setSort("")} className="ios-filter-pill">全部</Button>
        {sorts.map((s) => (
          <Button aria-pressed={sort === s.cate} key={s.cate} onClick={() => setSort(s.cate)} className="ios-filter-pill">
            {s.name}
          </Button>
        ))}
      </div>

      <div className="flex-1 scroll-y px-4 pb-24">
        <CollectionLinks />
        {err && <p role="alert" className="mb-3 text-[12px] text-danger">{err}</p>}
        <div className="hg-cat-grid">
          {channels.map((c) => {
            const meta = metas[c.cate];
            return (
              <Button key={c.cate} className={`hg-cat-card${meta?.offline ? " is-offline" : ""}`}
                aria-label={meta?.offline ? `${c.name} 内容已下线` : `${c.name} ${meta?.count ?? 0} 部`}
                aria-disabled={meta?.offline || undefined}
                onClick={() => { if (!meta?.offline) push({ kind: "channel", cate: c.cate, name: c.name }); }}>
                {meta?.cover ? <Img src={meta.cover} alt="" /> : <span className="hg-cat-blank shimmer" aria-hidden="true" />}
                <span className="hg-cat-veil" aria-hidden="true" />
                {meta?.offline ? <span className="hg-cat-count">已下线</span>
                  : !!meta?.count && <span className="hg-cat-count">{fmt(meta.count)} 部</span>}
                <span className="hg-cat-copy">
                  <span className="hg-cat-name">{c.name}</span>
                  {c.desc && <span className="hg-cat-sub">{c.desc}</span>}
                </span>
              </Button>
            );
          })}
        </div>
        {loading && <div className="flex justify-center py-4"><Loader className="w-6 h-6 spinner" /></div>}

        <Button onClick={() => push({ kind: "posts" })} className="hg-cat-entry">
          <span className="hg-cat-entry-title">吃瓜</span>
          <span className="hg-cat-entry-sub">圈内爆料 · 每日更新</span>
          <IChevR size={14} />
        </Button>

        <p className="mt-3 text-center text-[12px] text-dim">没有想看的？去<Button className="text-primary px-1 pressable" onClick={() => setTab("search")}>搜索</Button>找找</p>
      </div>
      {wide && <div />}
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
  const [total, setTotal] = useState(0);
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
      if (reset) setTotal(res?.pagination?.total ?? 0);
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
    <div className="ios-page ios-tint-12 absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="px-3 pt-2 pb-3 flex items-center gap-2.5">
          <Button aria-label="返回" onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></Button>
          <span className="w-[40px] h-[40px] rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><IGrid size={21} strokeWidth={1.9} /></span>
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-on leading-tight">{name}</h1>
            <div role="status" className="text-[12px] text-mut">{replacing ? (loading ? "正在更新筛选结果…" : "筛选更新失败") : `共 ${total || items.length} 部 · 已加载 ${items.length} · ${page}/${Math.max(pages, 1)} 页`}</div>
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
            <Masonry videos={items} cols={wide ? undefined : 3} scopeKey={filterKey(serverSort, originalCate)} wide={wide} onOpen={(v) => { if (!replacing) push({ kind: "feed", videoIds: items.map((x) => x.id), index: items.findIndex((x) => x.id === v.id), title: name }); }} />
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
