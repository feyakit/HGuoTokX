import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { Detail, RankItem, TopicCard, VideoCard } from "../types";
import { useStore } from "../store";
import { Button } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { Empty, Img } from "../components/ui";
import { IBoltF, IChevR, IClose, IFireF, IPlayF, IRefresh, ISearch, Logo } from "../icons";
import { useContentPreferences } from "../contentPreferences";
import { PreferenceStorageNotice } from "../components/PreferenceStorageNotice";

const RankView = lazy(() => import("./Search").then(m => ({ default: m.RankView })));

/* 首页 v5 差异化架构 + 真实品质编排：
   顶栏 = 大字重流光排版顶栏（推荐 / 上新 / 热榜 + 搜索，彻底告别独立胶囊行）
   ① 推荐 = 官方口碑推荐榜主推展台（错峰避重）→ 热播风向标 TOP 10 真榜单 → 独家原创 16:10 宽画幅双列（跨模块去重）→ 精选专题企划 → 为你推荐海报流（支持一键「换一批」轮换淘片）
   ② 上新 = 零轮播！严格按真实上架时间倒序的首发杂志流（首发 6 部大卡 + 近期新片速览）
   ③ 热榜 = 一体式玻璃滑块 + 金银铜 3D 错落三联领奖台 + 真实比例流光热度条 */

const TABS = [
  { key: "all", label: "推荐" },
  { key: "new", label: "上新" },
  { key: "rank", label: "热榜" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
type FeedTab = Exclude<TabKey, "rank">;

type HeroSpot = {
  id: number;
  title: string;
  cover: string;
  tags: string[];
  score: number;
  episode_count: number;
  total_episodes?: number;
  is_finished: boolean;
  kicker: string;
};

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
/* 主推展台自动轮换间隔：2.1.2 有、3.0.0 重构时丢了（报告 7「三分钟内无自动轮换」） */
const HERO_ROTATE_MS = 6000;

const parseTime = (raw?: string) => {
  if (!raw) return NaN;
  return Date.parse(raw.trim().replace(" ", "T"));
};

const isNew = (v: VideoCard) => {
  const t = parseTime(v.created_at);
  return Number.isFinite(t) && Date.now() - t < WEEK;
};

const releaseLabel = (v: VideoCard) => {
  const raw = (v.created_at || "").trim();
  const t = parseTime(raw);
  if (Number.isFinite(t)) {
    const diff = Date.now() - t;
    if (diff >= 0 && diff < DAY) return "今日首发";
    if (diff >= 0 && diff < 3 * DAY) return "近3日上新";
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `${Number(m[2])}月${Number(m[3])}日 上新` : "新片上架";
};

export default function Home({ active }: { active: boolean; bottomInset?: number }) {
  const { push, lineEpoch, user, history, toast } = useStore();
  const { preferences, storageError, blockReason } = useContentPreferences();
  const [tab, setFeedTab] = useState<TabKey>("all");
  const [items, setItems] = useState<VideoCard[]>([]);
  const [recommendRanks, setRecommendRanks] = useState<RankItem[]>([]);
  const [topRanks, setTopRanks] = useState<RankItem[]>([]);
  const [originals, setOriginals] = useState<VideoCard[]>([]);
  const [topics, setTopics] = useState<TopicCard[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [seedPage, setSeedPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroDragX, setHeroDragX] = useState(0);
  const heroTouch = useRef<{ x: number; y: number } | null>(null);
  const [continueCard, setContinueCard] = useState<{ detail: Detail; ep: number; t: number; dur: number; at: number } | null>(null);
  const [dismissedContinue, setDismissedContinue] = useState(0);
  const loadingRef = useRef(false);
  const seq = useRef(0);
  const shelvesKey = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (p: number, key: FeedTab, replaceBatch = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    if (replaceBatch) setShuffling(true);
    setError("");
    const my = ++seq.current;
    try {
      const res = key === "new"
        ? await api.feed(p, 21, "new")
        : await api.feed(p, 21);
      if (my !== seq.current) return;
      const rows = (res?.items ?? []).filter(v => v && v.cover);
      const pages = Math.max(1, res?.pagination?.pages || 1);
      setTotalPages(pages);
      setItems(prev => (p === 1 || replaceBatch) ? rows : [...prev, ...rows.filter(r => !prev.some(x => x.id === r.id))]);
      setPage(p);
      if (replaceBatch) setSeedPage(p);
      setDone(!rows.length || p >= pages);
    } catch (e) {
      if (my === seq.current) setError((e as Error)?.message || "加载失败");
    } finally {
      if (my === seq.current) {
        setLoading(false);
        setShuffling(false);
        loadingRef.current = false;
      }
    }
  }, []);

  /* 推荐页专属异构货架数据（官方口碑推荐榜 + 热播榜 TOP10 + 独家原创宽画幅 + 精选专题）：按线路缓存 */
  useEffect(() => {
    if (!active || tab !== "all") return;
    const key = String(lineEpoch);
    if (shelvesKey.current === key) return;
    let alive = true;
    Promise.all([
      api.rank("recommend").then(r => (r?.items ?? []).filter(x => x && x.cover && x.video_id > 0).slice(0, 12)).catch(() => [] as RankItem[]),
      api.rank("hot").then(r => (r?.items ?? []).filter(x => x && x.cover && x.video_id > 0).slice(0, 10)).catch(() => [] as RankItem[]),
      api.originalVideos("all", 1, 10, "new").then(r => (r?.items ?? []).filter(x => x && x.cover && x.id > 0)).catch(() => [] as VideoCard[]),
      api.topics().then(r => (r?.items ?? []).filter(x => x && x.cover).slice(0, 8)).catch(() => [] as TopicCard[]),
    ]).then(([recRanks, hotRanks, origs, tps]) => {
      if (!alive) return;
      shelvesKey.current = key;
      setRecommendRanks(recRanks);
      setTopRanks(hotRanks);
      setOriginals(origs);
      setTopics(tps);
    });
    return () => { alive = false; };
  }, [active, tab, lineEpoch]);

  useEffect(() => {
    if (!active || tab === "rank") return;
    seq.current++;
    loadingRef.current = false;
    setShuffling(false);
    setItems([]);
    setSeedPage(1);
    setTotalPages(1);
    setDone(false);
    setHeroIndex(0);
    scrollRef.current?.scrollTo(0, 0);
    void load(1, tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tab, lineEpoch]);

  /* 继续观看：登录且有最近进度时浮现 */
  useEffect(() => {
    if (!active || !user) { setContinueCard(null); return; }
    const latest = history[0];
    if (!latest || !latest.id) { setContinueCard(null); return; }
    let alive = true;
    api.video(latest.id)
      .then(d => {
        if (!alive) return;
        setContinueCard(d ? { detail: d, ep: latest.ep, t: latest.t, dur: latest.dur, at: latest.at } : null);
      })
      .catch(() => { if (alive) setContinueCard(null); });
    return () => { alive = false; };
  }, [active, user, history]);

  const filterAllowed = useCallback(
    <T extends { tags?: string[] }>(list: T[]) =>
      preferences.paused ? list : list.filter(v => !blockReason(v.tags)),
    [preferences.paused, blockReason],
  );

  const visible = useMemo(() => filterAllowed(items), [items, filterAllowed]);
  const visibleRecRanks = useMemo(() => filterAllowed(recommendRanks), [recommendRanks, filterAllowed]);
  /* 热播风向标 TOP 10 严格保持 100% 原始榜单真实名次，不做任何人为抽调 */
  const visibleRanks = useMemo(() => filterAllowed(topRanks), [topRanks, filterAllowed]);
  const visibleOriginals = useMemo(() => filterAllowed(originals), [originals, filterAllowed]);

  /* 1. 顶部主推优选：优先从源站真实「口碑推荐榜」挑选高分剧，并主动错峰避开紧随其后的热播榜前三名 */
  const heroes = useMemo<HeroSpot[]>(() => {
    const hotTop3 = new Set(visibleRanks.slice(0, 3).map(r => r.video_id));
    const picked: HeroSpot[] = [];
    const seen = new Set<number>();

    const toHeroFromRank = (r: RankItem): HeroSpot => ({
      id: r.video_id,
      title: r.title,
      cover: r.cover,
      tags: r.tags || [],
      score: r.score,
      episode_count: r.episode_count,
      is_finished: r.is_finished,
      kicker: `口碑主推${r.score > 0 ? ` · ${r.score.toFixed(1)}分` : r.metric_label ? ` · ${r.metric_label}` : ""}`,
    });

    const toHeroFromVideo = (v: VideoCard): HeroSpot => ({
      id: v.id,
      title: v.title,
      cover: v.cover,
      tags: v.tags || [],
      score: v.score,
      episode_count: v.episode_count,
      total_episodes: v.total_episodes,
      is_finished: v.is_finished,
      kicker: `殿堂主推${v.score > 0 ? ` · ${v.score.toFixed(1)}分` : ""}`,
    });

    for (const r of visibleRecRanks) {
      if (picked.length >= 3) break;
      if (!hotTop3.has(r.video_id) && !seen.has(r.video_id)) {
        seen.add(r.video_id);
        picked.push(toHeroFromRank(r));
      }
    }
    for (const r of visibleRecRanks) {
      if (picked.length >= 3) break;
      if (!seen.has(r.video_id)) {
        seen.add(r.video_id);
        picked.push(toHeroFromRank(r));
      }
    }
    /* 网络波动兜底：推荐榜为空时从默认流优先选高分/热门且不撞热播前三的剧集 */
    if (picked.length < 3) {
      const highQuality = [...visible].sort((a, b) => (Number(b.is_hot === 1) - Number(a.is_hot === 1)) || ((b.score || 0) - (a.score || 0)));
      for (const v of highQuality) {
        if (picked.length >= 3) break;
        if (!hotTop3.has(v.id) && !seen.has(v.id)) {
          seen.add(v.id);
          picked.push(toHeroFromVideo(v));
        }
      }
      for (const v of visible) {
        if (picked.length >= 3) break;
        if (!seen.has(v.id)) {
          seen.add(v.id);
          picked.push(toHeroFromVideo(v));
        }
      }
    }
    return picked;
  }, [visibleRecRanks, visibleRanks, visible]);

  const safeHeroIdx = Math.min(heroIndex, Math.max(heroes.length - 1, 0));
  const hero = heroes[safeHeroIdx];

  /* 主推展台自动轮换：只在「推荐」分栏可见、页面在前台时走；手动点圆点/横滑后重新计时
     （依赖里带 safeHeroIdx，任何一次切换都会把定时器重置，不会刚点完就被自动换走）。 */
  useEffect(() => {
    if (!active || tab !== "all" || heroes.length < 2) return undefined;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return undefined;
    const timer = window.setInterval(() => {
      setHeroIndex(prev => (prev + 1) % heroes.length);
    }, HERO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [active, tab, heroes.length, safeHeroIdx]);

  /* 2. 跨模块级联去重：主推展示过的剧集不再重复出现在「独家原创」与「为你推荐」，一屏张张是新剧 */
  const dedupedOriginals = useMemo(() => {
    const heroIds = new Set(heroes.map(h => h.id));
    const filtered = visibleOriginals.filter(v => !heroIds.has(v.id));
    if (filtered.length >= 4) return filtered.slice(0, 4);
    const ids = new Set(filtered.map(v => v.id));
    const backfill = visibleOriginals.filter(v => !ids.has(v.id)).slice(0, 4 - filtered.length);
    return [...filtered, ...backfill];
  }, [visibleOriginals, heroes]);

  const recommendGrid = useMemo(() => {
    const shownAbove = new Set<number>([
      ...heroes.map(h => h.id),
      ...dedupedOriginals.map(v => v.id),
    ]);
    const filtered = visible.filter(v => !shownAbove.has(v.id));
    if (filtered.length > 0 || visible.length <= heroes.length) return filtered;
    const heroIds = new Set(heroes.map(h => h.id));
    return visible.filter(v => !heroIds.has(v.id));
  }, [visible, heroes, dedupedOriginals]);

  /* 3. 为你推荐「换一批」：按真实分页池轮换下一批片单，原地平滑替换不跳滚 */
  const rotateRecommend = useCallback(() => {
    if (loadingRef.current) return;
    const cap = Math.max(1, Math.min(totalPages, 15));
    const nextSeed = cap > 1 ? (seedPage % cap) + 1 : 1;
    void load(nextSeed, "all", true);
  }, [load, seedPage, totalPages]);

  /* 上新分栏数据切片：按真实上架时间倒序，前 6 部用杂志横排首发看点卡，其余进入速览网格 */
  const premiereFeatured = useMemo(() => visible.slice(0, 6), [visible]);
  const premiereRest = useMemo(() => visible.slice(6), [visible]);
  const finishedInNew = useMemo(() => visible.filter(v => v.is_finished).length, [visible]);

  const continueShown = !!(user && continueCard && continueCard.at !== dismissedContinue);
  const continuePct = continueShown && continueCard && continueCard.dur > 0
    ? Math.max(1, Math.min(100, Math.round((continueCard.t / continueCard.dur) * 100))) : 0;

  const openSeries = (id: number) => push({ kind: "series", id });
  const play = (id: number, ep = 1, startTime?: number) => push({
    kind: "feed", videoIds: [id], index: 0, title: "", startEp: ep,
    startTime: startTime && startTime > 0 ? startTime : undefined,
  });
  const startSwipeIds = (ids: number[], startIdx = 0, title = "推荐连刷", endless = false) => {
    const unique: number[] = [];
    const seen = new Set<number>();
    for (const id of ids) {
      if (id > 0 && !seen.has(id)) {
        seen.add(id);
        unique.push(id);
      }
    }
    if (!unique.length) {
      toast(loading ? "内容加载中，请稍候" : "暂无可连刷内容", "info");
      return;
    }
    push({
      kind: "feed",
      videoIds: unique,
      index: Math.max(0, Math.min(startIdx, unique.length - 1)),
      title,
      endless,
    });
  };
  const startSwipeFeed = (list: VideoCard[], startIdx = 0, title = "推荐连刷") =>
    startSwipeIds(list.map(v => v.id), startIdx, title);

  return (
    <div className="ios-page hg-home-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />

      {/* 一级大字重流光顶栏：品牌徽标 + 推荐/上新/热榜 大字排版 + 全局搜索（省掉整排胶囊栏） */}
      <header className="shrink-0 hg-page-x hg-editorial-bar relative z-10">
        <Logo size={23} className="shrink-0 mr-1" />
        <div className="hg-ed-tabs" role="tablist" aria-label="首页分栏">
          {TABS.map(t => (
            <Button key={t.key} card role="tab" aria-selected={t.key === tab}
              className="hg-ed-tab"
              onClick={() => setFeedTab(t.key)}>
              {t.label}
            </Button>
          ))}
        </div>
        <Button card className="hg-binge-pill" aria-label="抖音模式"
          onClick={() => push({ kind: "feed", videoIds: [], index: 0, title: "抖音模式", endless: true })}>
          <IBoltF size={12} /><span>抖音模式</span>
        </Button>
        <Button card className="hg-sub-btn" aria-label="搜索" onClick={() => push({ kind: "search", initialTab: "video" })}>
          <ISearch size={18} />
        </Button>
      </header>

      <div ref={scrollRef} className="flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: `calc(${continueShown ? 190 : 110}px + var(--sab, 0px))` }}
        onScroll={(e) => {
          if (tab === "rank" || loading || done || error) return;
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 360) void load(page + 1, tab);
        }}>
        {storageError && <PreferenceStorageNotice />}

        {/* ==================== 分栏 ③：热榜（三联领奖台 + 热度条榜单） ==================== */}
        {tab === "rank" ? (
          <div className="pt-1.5">
            <Suspense fallback={<div className="flex justify-center py-10"><Loader className="w-7 h-7 spinner" /></div>}>
              <RankView wide={false} active={active} />
            </Suspense>
          </div>
        ) : tab === "new" ? (
          /* ==================== 分栏 ②：上新（零轮播！时间轴杂志首发流） ==================== */
          <div className="pt-1">
            {!items.length && loading && <div className="flex justify-center py-12"><Loader className="w-7 h-7 spinner" /></div>}
            {!items.length && !loading && error && (
              <Empty icon={<ISearch size={26} />} title="新片加载失败" sub={error} action="重试" onAction={() => void load(1, "new")} />
            )}
            {!items.length && !loading && !error && done && (
              <Empty icon={<ISearch size={26} />} title="暂无新片" sub="稍后刷新试试" action="刷新" onAction={() => void load(1, "new")} />
            )}

            {visible.length > 0 && (
              <>
                {/* 首发统计横幅 + 一键连刷上新 */}
                <div className="hg-drop-banner a-rise">
                  <div className="min-w-0">
                    <div className="hg-drop-title">新片速递 · 每日鲜看</div>
                    <div className="hg-drop-sub">
                      已收录 {visible.length} 部新上架剧集{finishedInNew > 0 ? ` · ${finishedInNew} 部已完结可一口气追完` : ""}
                    </div>
                  </div>
                  <Button card className="hg-quick-action" onClick={() => startSwipeFeed(visible, 0, "新片连刷")}>
                    <IBoltF size={13} /><span>连刷上新</span>
                  </Button>
                </div>

                {/* 时间轴第一段：重点新剧杂志横排看点卡（按真实上架时间倒序，避免与热度 TOP 榜混淆） */}
                <div className="hg-timeline-head">
                  <span className="hg-timeline-dot" aria-hidden="true" />
                  <h2 className="hg-timeline-label">首发看点 · 刚上架新剧</h2>
                  <span className="hg-timeline-line" aria-hidden="true" />
                  <span className="hg-timeline-count">首发 {premiereFeatured.length} 部</span>
                </div>

                <div className="hg-premiere-list">
                  {premiereFeatured.map((v, idx) => (
                    <article key={v.id} className="hg-premiere-card pressable a-rise" onClick={() => openSeries(v.id)}>
                      <div className="hg-premiere-art">
                        <Img src={v.cover} eager={idx < 2} alt="" />
                        <span className="hg-premiere-ep">
                          {v.is_finished ? `全 ${v.episode_count || v.total_episodes || "?"} 集` : `更至 ${v.episode_count || "?"} 集`}
                        </span>
                      </div>
                      <div className="hg-premiere-body">
                        <div>
                          <div className="hg-premiere-meta-top">
                            <span>{releaseLabel(v)}</span>
                            {v.score > 0 && <span>· ★ {v.score.toFixed(1)}</span>}
                            {v.is_hot === 1 && <span>· 热门</span>}
                            {v.is_original === 1 && <span>· 原创</span>}
                            {v.hot > 0 && <span>· ▶ {fmt(v.hot)}</span>}
                          </div>
                          <h3 className="hg-premiere-title">{v.title}</h3>
                          <p className="hg-premiere-desc">
                            {v.description?.trim()
                              || (v.tags?.length
                                ? `主打${v.tags.slice(0, 3).join("、")}题材，${v.is_finished ? "全集已完结，适合一口气追完。" : `高能连载中，已更新 ${v.episode_count || 1} 集。`}`
                                : `${v.is_finished ? "全集已完结" : `更新至 ${v.episode_count || 1} 集`} · 热度 ${fmt(v.hot)}`)}
                          </p>
                        </div>
                        <div className="hg-premiere-foot">
                          <div className="hg-premiere-tags">
                            {(v.tags || []).slice(0, 3).map(tag => (
                              <span key={tag} role="button" tabIndex={0}
                                onClick={e => { e.stopPropagation(); push({ kind: "tag", tag, name: tag }); }}
                                onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); push({ kind: "tag", tag, name: tag }); } }}>
                                #{tag}
                              </span>
                            ))}
                          </div>
                          <button type="button" className="hg-premiere-play"
                            aria-label={`播放 ${v.title}`}
                            onClick={e => { e.stopPropagation(); play(v.id); }}>
                            <IPlayF size={11} />追剧
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {/* 时间轴第二段：近期新片速览网格 */}
                {premiereRest.length > 0 && (
                  <section className="hg-section">
                    <div className="hg-timeline-head">
                      <span className="hg-timeline-dot" style={{ background: "#7C5CFF", boxShadow: "0 0 10px rgba(124,92,255,.7)" }} aria-hidden="true" />
                      <h2 className="hg-timeline-label" style={{ color: "#E2E8F0" }}>近期新片速览</h2>
                      <span className="hg-timeline-line" aria-hidden="true" />
                      <span className="hg-timeline-count">{premiereRest.length} 部</span>
                    </div>
                    <div className="hg-grid-c3">
                      {premiereRest.map(v => (
                        <Button key={v.id} className="hg-poster is-c3" onClick={() => openSeries(v.id)}>
                          <span className="hg-poster-art">
                            <Img src={v.cover} alt="" />
                            <span className="hg-poster-veil" aria-hidden="true" />
                            <span className="hg-poster-badge">上新</span>
                            <span className="hg-poster-views">{releaseLabel(v).replace(" 上新", "")}</span>
                          </span>
                          <span className="hg-poster-name">{v.title}</span>
                          <span className="hg-poster-meta">{v.is_finished ? "全集完结" : `更至 ${v.episode_count ?? "?"} 集`}</span>
                        </Button>
                      ))}
                    </div>
                  </section>
                )}

                {!done && visible.length > 0 && (
                  <Button className="hg-loadmore" onClick={() => void load(page + 1, "new")} disabled={loading}>
                    {loading ? "加载中…" : "加载更多新片"}
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          /* ==================== 分栏 ①：推荐（影院主推 + 异构策展货架） ==================== */
          <>
            {!items.length && loading && <div className="flex justify-center py-12"><Loader className="w-7 h-7 spinner" /></div>}
            {!items.length && !loading && error && (
              <Empty icon={<ISearch size={26} />} title="首页加载失败" sub={error} action="重试" onAction={() => void load(1, "all")} />
            )}
            {!items.length && !loading && !error && done && (
              <Empty icon={<ISearch size={26} />} title="暂无视频" sub="稍后刷新试试" action="刷新" onAction={() => void load(1, "all")} />
            )}

            {/* 1. 影院级单主推展台（平滑横滑轮播 + 错峰避重 + 一键直达播放） */}
            {hero && (
              <div
                className="hg-spotlight-shell a-rise"
                onTouchStart={e => {
                  const t = e.touches[0];
                  if (t) {
                    heroTouch.current = { x: t.clientX, y: t.clientY };
                    setHeroDragX(0);
                  }
                }}
                onTouchMove={e => {
                  const start = heroTouch.current;
                  const t = e.touches[0];
                  if (!start || !t || heroes.length < 2) return;
                  const dx = t.clientX - start.x;
                  const dy = t.clientY - start.y;
                  if (Math.abs(dx) > Math.abs(dy) * 1.15 && Math.abs(dx) > 8) {
                    setHeroDragX(Math.max(-120, Math.min(120, dx * 0.48)));
                  }
                }}
                onTouchEnd={e => {
                  const start = heroTouch.current;
                  const t = e.changedTouches[0];
                  heroTouch.current = null;
                  setHeroDragX(0);
                  if (!start || !t || heroes.length < 2) return;
                  const dx = t.clientX - start.x;
                  const dy = t.clientY - start.y;
                  if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
                  setHeroIndex(() => (safeHeroIdx + (dx < 0 ? 1 : heroes.length - 1)) % heroes.length);
                }}
                onTouchCancel={() => { heroTouch.current = null; setHeroDragX(0); }}
              >
                <div className="hg-spotlight-viewport">
                  <div
                    className={`hg-spotlight-track${heroDragX !== 0 ? " is-dragging" : ""}`}
                    style={{ transform: `translate3d(calc(${-safeHeroIdx * 100}% + ${heroDragX}px), 0, 0)` }}
                  >
                    {heroes.map((h, i) => (
                      <div key={h.id} className="hg-spotlight-slide" data-active={String(i === safeHeroIdx)}>
                        <Button card className="hg-spotlight" aria-label={`${h.title} 详情`}
                          tabIndex={i === safeHeroIdx ? 0 : -1}
                          onClick={() => openSeries(h.id)}>
                          <Img src={h.cover} eager alt="" />
                          <span className="hg-spotlight-veil" aria-hidden="true" />
                          <span className="hg-spotlight-top">
                            <span className="hg-spotlight-kicker">
                              <IFireF size={12} />
                              <span>{h.kicker}</span>
                            </span>
                          </span>
                          <span className="hg-spotlight-body">
                            <span className="hg-spotlight-info">
                              <span className="hg-spotlight-title">{h.title}</span>
                              <span className="hg-spotlight-sub">
                                {h.tags?.length ? h.tags.slice(0, 3).join(" · ") : "精选剧集"}
                                {" · "}
                                {h.is_finished ? `全 ${h.episode_count || h.total_episodes || "?"} 集` : `更新至 ${h.episode_count ?? "?"} 集`}
                              </span>
                            </span>
                            <span className="hg-spotlight-cta" role="button" tabIndex={i === safeHeroIdx ? 0 : -1}
                              onClick={e => { e.stopPropagation(); play(h.id); }}
                              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); play(h.id); } }}>
                              <IPlayF size={12} />播放
                            </span>
                          </span>
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                {heroes.length > 1 && (
                  <div className="hg-spotlight-bars" role="tablist" aria-label="精选焦点切换">
                    {heroes.map((h, i) => (
                      <button key={h.id} type="button" role="tab"
                        className="hg-spotlight-bar"
                        data-on={String(i === safeHeroIdx)}
                        aria-selected={i === safeHeroIdx}
                        aria-label={`焦点推荐 ${i + 1}: ${h.title}`}
                        onClick={() => setHeroIndex(i)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. 热播风向标 TOP 10（空心大号描边数字横滑榜：100% 原始热播榜真名次） */}
            {visibleRanks.length > 0 && (
              <section className="hg-section">
                <div className="hg-section-head">
                  <h2 className="hg-section-title">热播风向标</h2>
                  <Button className="hg-section-more" onClick={() => setFeedTab("rank")}>完整榜单<IChevR size={11} /></Button>
                </div>
                <div className="hg-top10-rail">
                  {visibleRanks.map((r, idx) => {
                    const rankNum = r.rank || idx + 1;
                    return (
                      <Button key={`${r.video_id}-${rankNum}`} card className="hg-top10-card"
                        onClick={() => openSeries(r.video_id)}>
                        <span className="hg-top10-art">
                          <Img src={r.cover} alt="" />
                          {r.metric_value > 0 && (
                            <span className="hg-top10-heat">{r.metric_label || "热度"} {fmt(r.metric_value)}</span>
                          )}
                        </span>
                        <span className={`hg-top10-num${rankNum <= 3 ? " is-top3" : ""}`} aria-hidden="true">
                          {String(rankNum).padStart(2, "0")}
                        </span>
                        <span className="hg-top10-title">{r.title}</span>
                      </Button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. 独家原创 · 16:10 宽画幅双列剧照（跨模块去重，打破满屏竖版疲劳） */}
            {dedupedOriginals.length > 0 && (
              <section className="hg-section">
                <div className="hg-section-head">
                  <h2 className="hg-section-title">独家原创 · 宽画幅精选</h2>
                  <Button className="hg-section-more" onClick={() => push({ kind: "channel", cate: "original", name: "独家原创" })}>
                    全部原创<IChevR size={11} />
                  </Button>
                </div>
                <div className="hg-wide-grid">
                  {dedupedOriginals.map(v => (
                    <Button key={v.id} card className="hg-wide-card" onClick={() => openSeries(v.id)}>
                      <span className="hg-wide-art">
                        <Img src={v.cover} alt="" />
                        <span className="hg-wide-badge">原创</span>
                        <span className="hg-wide-ep">{v.is_finished ? "已完结" : `更至 ${v.episode_count ?? "?"} 集`}</span>
                      </span>
                      <span className="hg-wide-copy">
                        <span className="hg-wide-title">{v.title}</span>
                        <span className="hg-wide-sub">
                          {v.tags?.length ? v.tags.slice(0, 2).join(" · ") : "官方自制精品"} · ▶ {fmt(v.hot)}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {/* 4. 精选专题企划横滑 */}
            {topics.length > 0 && (
              <section className="hg-section">
                <div className="hg-section-head">
                  <h2 className="hg-section-title">策展专题</h2>
                  <Button className="hg-section-more" onClick={() => push({ kind: "topics" })}>全部专题<IChevR size={11} /></Button>
                </div>
                <div className="hg-topic-rail">
                  {topics.map(t => (
                    <Button key={t.id} card className="hg-topic-mini"
                      onClick={() => push({ kind: "topic", slug: t.slug, name: t.title })}>
                      <span className="hg-topic-mini-art">
                        <Img src={t.cover} alt="" />
                        <span className="hg-topic-mini-veil" aria-hidden="true" />
                        <span className="hg-topic-mini-copy">
                          <span className="hg-topic-mini-cnt">{t.video_count ?? 0} 部片单</span>
                          <span className="hg-topic-mini-title">{t.title}</span>
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {/* 5. 为你推荐海报流（已剔除上方主推与原创重复剧集，支持一键「换一批」淘片） */}
            <section className="hg-section">
              <div className="hg-section-head">
                <h2 className="hg-section-title">为你推荐</h2>
                <div className="hg-section-actions">
                  {visible.length > 0 && (
                    <Button card className="hg-shuffle-btn" aria-label="换一批推荐" aria-busy={shuffling}
                      disabled={loading} onClick={rotateRecommend}>
                      <IRefresh size={12} /><span>{shuffling ? "换片中" : "换一批"}</span>
                    </Button>
                  )}
                  {recommendGrid.length > 0 && (
                    <Button className="hg-section-more" onClick={() => startSwipeFeed(recommendGrid, 0, "为你推荐")}>
                      刷一刷<IChevR size={11} />
                    </Button>
                  )}
                </div>
              </div>
              <div className="hg-grid-c3">
                {recommendGrid.map(v => (
                  <Button key={v.id} className="hg-poster is-c3" onClick={() => openSeries(v.id)}>
                    <span className="hg-poster-art">
                      <Img src={v.cover} alt="" />
                      <span className="hg-poster-veil" aria-hidden="true" />
                      {v.is_hot === 1
                        ? <span className="hg-poster-badge is-hot">热门</span>
                        : isNew(v) ? <span className="hg-poster-badge">上新</span> : null}
                      <span className="hg-poster-views">▶ {fmt(v.hot)}</span>
                    </span>
                    <span className="hg-poster-name">{v.title}</span>
                    <span className="hg-poster-meta">
                      {v.tags?.[0] ? `${v.tags[0]} · ` : ""}{v.is_finished ? "全集" : `${v.episode_count ?? "?"} 集`}
                    </span>
                  </Button>
                ))}
              </div>
              {!done && recommendGrid.length > 0 && (
                <Button className="hg-loadmore" onClick={() => void load(page + 1, "all")} disabled={loading}>
                  {loading ? "加载中…" : "加载更多"}
                </Button>
              )}
              {done && recommendGrid.length > 0 && (
                <p className="hg-list-end">已经到底了 · 共 {recommendGrid.length} 部</p>
              )}
            </section>
          </>
        )}
      </div>

      {/* 继续观看悬浮卡 */}
      {continueShown && continueCard && (
        <div className="hg-continue">
          <span className="hg-continue-art"><Img src={continueCard.detail.cover} alt="" /></span>
          <span className="hg-continue-copy">
            <span className="hg-continue-title">{continueCard.detail.title}</span>
            <span className="hg-continue-sub">
              看到第 {continueCard.ep} 集
              {continueCard.detail.episode_count ? ` / 共 ${continueCard.detail.episode_count} 集` : ""}
              {continuePct ? ` · ${continuePct}%` : ""}
            </span>
          </span>
          <Button card className="hg-continue-play" aria-label={`继续播放第 ${continueCard.ep} 集`}
            onClick={() => play(continueCard.detail.id, continueCard.ep, continueCard.t)}><IPlayF size={18} /></Button>
          <Button card className="hg-continue-close" aria-label="隐藏继续观看"
            onClick={() => setDismissedContinue(continueCard.at)}><IClose size={11} /></Button>
          {continuePct > 0 && <span className="hg-continue-fill" style={{ width: `${continuePct}%` }} aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
