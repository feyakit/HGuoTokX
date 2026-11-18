import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Detail, VideoCard } from "../types";
import { useStore } from "../store";
import { Button } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { Empty } from "../components/ui";
import { Img } from "../components/ui";
import { IChevR, IClose, IPlayF, ISearch, ISettings } from "../icons";
import { useContentPreferences } from "../contentPreferences";
import { PreferenceStorageNotice } from "../components/PreferenceStorageNotice";

/* 首页结构（数值全部取自 参考实测.json 的 v3 段）：
   顶栏 3 层 = 状态栏 → 品牌行（左 logo，右 搜索；礼物图标无接口不做）→ 胶囊 tab（选中=实心胶囊）
   内容     = Hero（前 3 条轮播 + Play 胶囊 + 卡外 3 圆点）→ 最新上架横滑 → 3 列网格
   继续观看 = 参考 S1 的那张悬浮卡（封面 + 集数/进度 + 圆形播放 + 右上关闭），压在底栏之上；
              数据取 accountHistory（store.history），游客态或历史为空整个模块不渲染
   底栏     = 宽浮岛 328×57、左右各 16（v3.tabbar 实测 0.911×360）；内容 pb = 57 + 16 + 安全区
   排行榜不在首页：它是独立一屏（/api/ranks/hot，固定 20 条），入口是胶囊 tab「榜单」 */

const TABS = [
  { key: "all", label: "All Shows" },
  { key: "new", label: "New Shows" },
  { key: "rank", label: "Ranking" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
type FeedTab = Exclude<TabKey, "rank">;

/* NEW 角标：接口无 is_new 字段，按 created_at 是否 7 天内判（真数据，不编） */
const WEEK = 7 * 24 * 60 * 60 * 1000;
const isNew = (v: VideoCard) => {
  const t = Date.parse((v.created_at || "").replace(" ", "T"));
  return Number.isFinite(t) && Date.now() - t < WEEK;
};

export default function Home({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { push, lineEpoch, setTab, user, history } = useStore();
  const { preferences, storageError, blockReason } = useContentPreferences();
  const [tab, setFeedTab] = useState<FeedTab>("all");
  const [items, setItems] = useState<VideoCard[]>([]);
  const [rail, setRail] = useState<VideoCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);
  /* 轮播：原生横滑 + scroll-snap（Chrome 87 支持），圆点与滚动位置双向同步 */
  const heroTrack = useRef<HTMLDivElement>(null);
  const goHero = (i: number) => {
    const el = heroTrack.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setHeroIndex(i);
  };
  const onHeroScroll = () => {
    const el = heroTrack.current;
    if (!el || !el.clientWidth) return;
    const i = Math.max(0, Math.min(heroes.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
    setHeroIndex(prev => (prev === i ? prev : i));
  };
  const [continueCard, setContinueCard] = useState<{ detail: Detail; ep: number; t: number; dur: number; at: number } | null>(null);
  /* 关掉的那一条按 updated_at 记：换了剧或看了新一集，卡片自己回来，不用等刷新 */
  const [dismissedContinue, setDismissedContinue] = useState(0);
  const loadingRef = useRef(false);
  const seq = useRef(0);

  /* 列表：全部 → api.feed（/api/videos）；最新 → api.feed(sort=new)；
     原创 → api.originalVideos（/api/videos?is_original=1） */
  const load = useCallback(async (p: number, key: FeedTab) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    const my = ++seq.current;
    try {
      const res = key === "new"
        ? await api.feed(p, 21, "new")
        : await api.feed(p, 21);
      if (my !== seq.current) return;
      const rows = (res?.items ?? []).filter(v => v && v.cover);
      setItems(prev => p === 1 ? rows : [...prev, ...rows.filter(r => !prev.some(x => x.id === r.id))]);
      setPage(p);
      setDone(!rows.length || !!(res?.pagination && p >= (res.pagination.pages || 1)));
    } catch (e) {
      if (my === seq.current) setError((e as Error)?.message || "加载失败");
    } finally {
      if (my === seq.current) { setLoading(false); loadingRef.current = false; }
    }
  }, []);

  /* 最新上架横滑：始终 /api/videos?sort=new 第一页，和当前胶囊无关 */
  const loadRail = useCallback(() => {
    api.feed(1, 12, "new").then(r => setRail((r?.items ?? []).filter(v => v && v.cover))).catch(() => setRail([]));
  }, []);

  useEffect(() => {
    if (!active) return;
    setItems([]);
    setDone(false);
    setHeroIndex(0);
    void load(1, tab);
    loadRail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tab, lineEpoch]);

  /* 继续观看：accountHistory（store.history 已按 updated_at 倒序，[0] 就是最近一条）
     + api.video(id) 补标题/封面/总集数；游客态或历史为空 → 直接不渲染，不画空占位 */
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

  const visible = preferences.paused ? items : items.filter(v => !blockReason(v.tags));
  const heroes = useMemo(() => visible.slice(0, 3), [visible]);
  const hero = heroes[Math.min(heroIndex, Math.max(heroes.length - 1, 0))];
  const grid = visible.slice(heroes.length);
  /* 继续观看只在「登录 + 历史非空 + 没被本机关掉这一条」时存在；空态整个模块不渲染 */
  const continueShown = !!(user && continueCard && continueCard.at !== dismissedContinue);
  const continuePct = continueShown && continueCard && continueCard.dur > 0
    ? Math.max(1, Math.min(100, Math.round((continueCard.t / continueCard.dur) * 100))) : 0;
  const openSeries = (id: number) => push({ kind: "series", id });
  const play = (id: number, ep = 1, startTime?: number) => push({
    kind: "feed", videoIds: [id], index: 0, title: "", startEp: ep,
    startTime: startTime && startTime > 0 ? startTime : undefined,
  });

  return (
    <div className="ios-page hg-home-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />

      {/* 顶栏第 2 层：品牌行（左 HGuoX 文字标，右 搜索 21） */}
      <div className="shrink-0 hg-page-x hg-brand-row relative z-10">
        <span className="hg-brand">HGuoX</span>
        <span className="flex-1" />
        <Button card className="hg-icon-plain" aria-label="搜索" onClick={() => setTab("search")}><ISearch size={21} /></Button>
        <Button card className="hg-icon-plain ml-1" aria-label="设置" onClick={() => push({ kind: "settings" })}><ISettings size={20} /></Button>
      </div>

      {/* 顶栏第 3 层：胶囊 tab（All Shows / New Shows / Ranking） */}
      <div className="shrink-0 hg-page-x hg-chip-row relative z-10">
        <div className="hg-pill-row" role="tablist" aria-label="首页分栏">
          {TABS.map(t => (
            <Button card key={t.key} role="tab" aria-selected={t.key === tab}
              className="hg-pill"
              onClick={() => t.key === "rank" ? push({ kind: "ranks" }) : setFeedTab(t.key)}>{t.label}</Button>
          ))}
        </div>
      </div>

      <div className="flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: `calc(${continueShown ? 190 : 110}px + var(--sab, 0px))` }}>
        {storageError && <PreferenceStorageNotice />}

        {!items.length && loading && <div className="flex justify-center py-10"><Loader className="w-7 h-7 spinner" /></div>}
        {!items.length && !loading && error && (
          <Empty icon={<ISearch size={26} />} title="首页加载失败" sub={error} action="重试" onAction={() => void load(1, tab)} />
        )}
        {!items.length && !loading && !error && done && (
          <Empty icon={<ISearch size={26} />} title="暂无视频" sub="稍后刷新试试" action="刷新" onAction={() => void load(1, tab)} />
        )}

        {/* Hero：列表前 3 条（358×220 约 16:10、圆角 20、主标题+副标题+深色 Play 胶囊、卡外 3 圆点） */}
        {hero && (
          <div className="hg-hero-wrap">
            <div className="hg-hero-track" ref={heroTrack} onScroll={onHeroScroll}>
              {heroes.map((h, i) => (
                <Button key={h.id} card className="hg-hero" aria-label={`${h.title} 详情`} onClick={() => openSeries(h.id)}>
                  <Img src={h.cover} eager={i === 0} alt="" />
                  <span className="hg-hero-veil" aria-hidden="true" />
                  <span className="hg-hero-copy">
                    <span className="hg-hero-title">{h.title}</span>
                    <span className="hg-hero-sub">
                      {h.tags?.length ? h.tags.slice(0, 3).join(" · ") : (h.is_finished ? "Completed" : `${h.episode_count ?? "?"} Episodes`)}
                    </span>
                    <span className="hg-hero-play" role="button" tabIndex={0}
                      onClick={e => { e.stopPropagation(); play(h.id); }}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); play(h.id); } }}>
                      <IPlayF size={12} />Play
                    </span>
                  </span>
                </Button>
              ))}
            </div>
            {heroes.length > 1 && (
              <div className="hg-dots" role="tablist" aria-label="推荐轮播">
                {heroes.map((h, i) => (
                  <button key={h.id} type="button" className="hg-dot" data-on={String(i === heroIndex)}
                    aria-label={`第 ${i + 1} 个推荐`} aria-selected={i === heroIndex}
                    onClick={() => goHero(i)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* New Dramas 横滑：仅在 All Shows 下显示，避免 New Shows 下重复两节 */}
        {tab === "all" && rail.length > 0 && (
          <section className="hg-section">
            <div className="hg-section-head">
              <h2 className="hg-section-title">New Dramas</h2>
              <Button className="hg-section-more" onClick={() => setFeedTab("new")}>More<IChevR size={10} /></Button>
            </div>
            <div className="hg-rail">
              {rail.map(v => (
                <Button card key={v.id} className="hg-rail-card" onClick={() => openSeries(v.id)}>
                  <span className="hg-rail-art">
                    <Img src={v.cover} alt="" />
                    {isNew(v) && <span className="hg-rail-badge">NEW</span>}
                    <span className="hg-rail-name">{v.title}</span>
                  </span>
                </Button>
              ))}
            </div>
          </section>
        )}

        {/* 3 列网格 */}
        <section className="hg-section">
          <div className="hg-section-head">
            <h2 className="hg-section-title">{tab === "new" ? "New Dramas" : "For You"}</h2>
          </div>
          <div className="hg-grid-c3">
            {grid.map(v => (
              <Button key={v.id} className="hg-poster is-c3" onClick={() => openSeries(v.id)}>
                <span className="hg-poster-art">
                  <Img src={v.cover} alt="" />
                  {isNew(v) && <span className="hg-poster-badge">NEW</span>}
                </span>
                <span className="hg-poster-name">{v.title}</span>
                <span className="hg-poster-meta">{v.is_finished ? "Completed" : `${v.episode_count ?? "?"} Eps`}</span>
              </Button>
            ))}
          </div>
          {!done && grid.length > 0 && (
            <Button className="hg-loadmore" onClick={() => void load(page + 1, tab)} disabled={loading}>
              {loading ? "Loading…" : "Load More"}
            </Button>
          )}
        </section>
      </div>

      {/* 继续观看悬浮卡（对照设计稿第 1 页） */}
      {continueShown && continueCard && (
        <div className="hg-continue">
          <span className="hg-continue-art"><Img src={continueCard.detail.cover} alt="" /></span>
          <span className="hg-continue-copy">
            <span className="hg-continue-title">{continueCard.detail.title}</span>
            <span className="hg-continue-sub">
              Last watched: Episode {continueCard.ep}
              {continueCard.detail.episode_count ? ` / ${continueCard.detail.episode_count}` : ""}
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
