import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmt } from "../api";
import type { RankItem, TopicCard, VideoCard } from "../types";
import { useStore } from "../store";
import { Button } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { Empty } from "../components/ui";
import { Img } from "../components/ui";
import { IChevR, ISearch } from "../icons";
import { useContentPreferences } from "../contentPreferences";
import { PreferenceStorageNotice } from "../components/PreferenceStorageNotice";

/* Fisher-Yates 洗牌：第一页打乱，避免每次进来都是同一部当 Hero */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 首页：顶栏 Tab → Hero → 货架（热播榜 / 精选专辑）→ 双列海报网格。
 * 尺寸全部来自 styles/shelf.css 的 token；点卡片进剧集详情页，播放从详情页发起。
 */
export default function Home({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { push, lineEpoch } = useStore();
  const { preferences, storageError, blockReason } = useContentPreferences();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [rank, setRank] = useState<RankItem[]>([]);
  const [topics, setTopics] = useState<TopicCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const loadingRef = useRef(false);
  const seq = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(async (p: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    const my = ++seq.current;
    try {
      const res = await api.feed(p, 20);
      if (my !== seq.current) return;
      const rows = (res?.items ?? []).filter(v => v && v.cover);
      const ordered = p === 1 ? shuffle(rows) : rows;
      setItems(prev => {
        const seen = new Set(prev.map(x => x.id));
        return [...prev, ...ordered.filter(x => !seen.has(x.id))];
      });
      setPage(p);
      setDone(!rows.length || !!(res?.pagination && p >= (res.pagination.pages || 1)));
    } catch (e) {
      if (my === seq.current) setError((e as Error)?.message || "加载失败");
    } finally {
      if (my === seq.current) { setLoading(false); loadingRef.current = false; }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!itemsRef.current.length) void load(1);
    api.rank("hot").then(r => setRank((r?.items ?? []).slice(0, 5))).catch(() => setRank([]));
    api.topics().then(r => setTopics((r?.items ?? []).slice(0, 8))).catch(() => setTopics([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lineEpoch]);

  /* 内容偏好：被屏蔽标签的条目不上首页（与原首页行为一致） */
  const visible = preferences.paused ? items : items.filter(v => !blockReason(v.tags));
  const hero = visible[0];
  const grid = visible.slice(1);
  const openSeries = (id: number) => push({ kind: "series", id });

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />

      {/* 顶栏：Tab + 搜索 */}
      <div className="shrink-0 flex items-center gap-3 hg-page-x pb-2 relative z-10"
        style={{ paddingTop: "calc(var(--sat, 0px) + 6px)" }}>
        <div className="hg-tabs" role="tablist" aria-label="首页分栏">
          <Button role="tab" aria-selected="true" className="hg-tab is-on">短剧</Button>
          <Button role="tab" aria-selected="false" className="hg-tab" onClick={() => push({ kind: "posts" })}>吃瓜</Button>
        </div>
        <span className="flex-1" />
        <Button className="ios-icon-button" aria-label="搜索" onClick={() => push({ kind: "tags" })}><ISearch size={18} /></Button>
      </div>

      <div className="flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: `calc(84px + var(--sab, 0px) + ${bottomInset}px)` }}>
        {storageError && <PreferenceStorageNotice />}

        {!items.length && loading && <div className="flex justify-center py-10"><Loader className="w-7 h-7 spinner" /></div>}
        {!items.length && !loading && error && (
          <Empty icon={<ISearch size={26} />} title="首页加载失败" sub={error} action="重试" onAction={() => void load(1)} />
        )}
        {!items.length && !loading && !error && done && (
          <Empty icon={<ISearch size={26} />} title="暂无视频" sub="稍后刷新试试" action="刷新" onAction={() => void load(1)} />
        )}

        {hero && (
          <Button className="hg-hero" aria-label={`${hero.title} 详情`} onClick={() => openSeries(hero.id)}>
            <Img src={hero.cover} eager alt="" />
            <span className="hg-hero-veil" aria-hidden="true" />
            <span className="hg-hero-copy">
              <span className="hg-hero-title">{hero.title}</span>
              <span className="hg-hero-sub">
                {hero.is_finished ? "已完结" : `更新至 ${hero.episode_count ?? "?"} 集`}
                {!!hero.hot && ` · ${fmt(hero.hot)} 次播放`}
              </span>
            </span>
          </Button>
        )}

        {rank.length > 0 && (
          <section className="hg-section">
            <div className="hg-section-head">
              <h2 className="hg-section-title">热播榜</h2>
              <Button className="hg-section-more" onClick={() => push({ kind: "ranks" })}>全部<IChevR size={11} /></Button>
            </div>
            <ol>
              {rank.map(item => (
                <li key={item.video_id}>
                  <Button className="hg-rank-row" onClick={() => openSeries(item.video_id)}>
                    <span className="hg-rank-no">{item.rank}</span>
                    <span className="hg-rank-cover"><Img src={item.cover} alt="" /></span>
                    <span className="hg-rank-copy">
                      <span className="hg-rank-title">{item.title}</span>
                      <span className="hg-rank-meta">{item.tags?.slice(0, 2).join(" · ")}</span>
                    </span>
                    <span className="hg-rank-heat">{fmt(item.metric_value)}</span>
                  </Button>
                </li>
              ))}
            </ol>
          </section>
        )}

        {topics.length > 0 && (
          <section className="hg-section">
            <div className="hg-section-head">
              <h2 className="hg-section-title">精选专辑</h2>
              <Button className="hg-section-more" onClick={() => push({ kind: "topic", slug: topics[0].slug, name: "精选专辑" })}>全部<IChevR size={11} /></Button>
            </div>
            <div className="hg-shelf">
              {topics.map(t => (
                <Button key={t.id} className="hg-poster" onClick={() => push({ kind: "topic", slug: t.slug, name: t.title })}>
                  <span className="hg-poster-art">
                    <Img src={t.cover} alt="" />
                    <span className="hg-poster-badge">{t.video_count ? `${fmt(t.video_count)} 部` : "专辑"}</span>
                  </span>
                  <span className="hg-poster-name">{t.title}</span>
                </Button>
              ))}
            </div>
          </section>
        )}

        <section className="hg-section">
          <div className="hg-section-head">
            <h2 className="hg-section-title">为你推荐</h2>
          </div>
          <div className="hg-grid">
            {grid.map(v => (
              <Button key={v.id} className="hg-poster is-grid" onClick={() => openSeries(v.id)}>
                <span className="hg-poster-art">
                  <Img src={v.cover} alt="" />
                  {v.is_finished && <span className="hg-poster-badge">已完结</span>}
                </span>
                <span className="hg-poster-name">{v.title}</span>
                <span className="hg-poster-meta">{v.is_finished ? "全" : `${v.episode_count ?? "?"} 集`}</span>
              </Button>
            ))}
          </div>
          {!done && grid.length > 0 && (
            <Button className="hg-loadmore" onClick={() => void load(page + 1)} disabled={loading}>
              {loading ? "加载中…" : "加载更多"}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
