import { useEffect, useMemo, useRef, useState } from "react";
import { api, cover, fmt } from "../api";
import { cachedDetail, loadDetail } from "../detailFast";
import { useStore } from "../store";
import { ambientStyle, useAccent } from "../useAccent";
import { Button } from "../components/ios/controls";
import { Img } from "../components/ui";
import { IBack, IPlayF, IStar, IStarF } from "../icons";
import type { Detail, VideoCard } from "../types";

/* 详情页（自定屏，依据 /opt/data/hguox-redesign/设计规范-自定屏.md）：
   顶部宽幅区 332×281 / 圆角 15：同张封面模糊放大铺底 + 暗蒙层，上面放 3:4 原比例封面（不裁）+ 剧名/评分/集数；
   下面依次是 #标签小签、简介、选集（5 列 56×56）、相关推荐；顶部悬浮返回 + 收藏按钮，底部智能续播主 CTA。 */
export default function SeriesDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { push, lineEpoch, history, isFav, setCollected, actionPending, toast } = useStore();
  const [detail, setDetail] = useState<Detail | null>(() => cachedDetail(id));
  const [related, setRelated] = useState<VideoCard[]>([]);
  const [err, setErr] = useState("");
  const [favDelta, setFavDelta] = useState(0);
  /* 慢线路兜底文案：3s 还没出详情就明说是线路慢，而不是让用户对着黑屏猜。 */
  const [slow, setSlow] = useState(false);
  const seq = useRef(0);
  const accentScheme = useAccent(id, detail?.cover ? cover(detail.cover, 900) : undefined);

  useEffect(() => {
    if (detail || err) { setSlow(false); return undefined; }
    const timer = window.setTimeout(() => setSlow(true), 3000);
    return () => window.clearTimeout(timer);
  }, [detail, err, id]);

  /* 播放器 chunk 预热：详情页里用户下一步大概率点「播放」，而播放器整条链
     （EpisodePlayer + hls.js，约 600KB）现在是按需 chunk。趁这次浏览的空闲先拉下来，
     点播放时就不用再等它下载+解析。失败无所谓，真点播放还会正常加载。 */
  useEffect(() => {
    const warm = () => { void import("../components/Feed"); };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) {
      const handle = ric(warm, { timeout: 1500 });
      return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(warm, 800);
    return () => window.clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    const my = ++seq.current;
    setErr("");
    setFavDelta(0);
    /* 首屏加速：预取命中时同步出内容（上面的 useState 初值），未命中走 loadDetail
       —— 超过 3s 会用一次自动选线并行换线重试，谁先回用谁。 */
    loadDetail(id)
      .then(res => { if (my === seq.current) setDetail(res); })
      .catch(e => { if (my === seq.current) setErr((e as Error)?.message || "加载失败"); });
    api.related(id)
      .then(res => { if (my === seq.current) setRelated((res?.items ?? []).filter(v => v && v.cover)); })
      .catch(() => { if (my === seq.current) setRelated([]); });
  }, [id, lineEpoch]);

  const episodes = useMemo(
    () => (detail?.episodes ?? []).slice().sort((a, b) => a.ep_num - b.ep_num),
    [detail],
  );

  const savedProg = useMemo(
    () => history.find(h => String(h.id) === String(id)),
    [history, id],
  );

  const faved = isFav(id, "video");
  const favBusy = actionPending(`collect:video:${id}`);

  const openPlayer = (ep?: number, startTime?: number) => {
    if (!detail) return;
    push({
      kind: "feed",
      videoIds: [detail.id],
      index: 0,
      title: detail.title,
      startEp: ep && ep > 0 ? ep : 1,
      startTime: startTime && startTime > 3 ? startTime : undefined,
    });
  };

  const toggleFav = () => {
    if (favBusy) return;
    const next = !faved;
    setFavDelta(d => d + (next ? 1 : -1));
    void setCollected("video", id, next)
      .then(() => toast(next ? "已加入收藏" : "已取消收藏", next ? "star" : "info"))
      .catch(e => {
        setFavDelta(d => d + (next ? -1 : 1));
        toast((e as Error)?.message || "收藏操作失败", "info");
      });
  };

  return (
    <div className="ios-page hg-detail-page hg-canvas absolute inset-0 flex flex-col"
      data-ambient={accentScheme.source}
      style={ambientStyle(accentScheme)}>
      <span className="hg-aura" aria-hidden="true"
        style={accentScheme.source === "image" ? {
          height: 460,
          background: `radial-gradient(80% 60% at 50% 16%, ${accentScheme.accent}48 0%, ${accentScheme.second}2c 48%, transparent 78%)`,
        } : undefined} />

      <div className="flex-1 scroll-y pb-6 relative z-10">
        {err && <p role="alert" className="py-6 text-center text-[12px] text-danger">{err}</p>}
        {/* 首屏骨架（报告 v3.0.5 P2-1：进详情后 11.7s 只有纯黑 + 中央 spinner）。
            骨架照着真页面的几何摆：72% 高的宽幅区 + 封面块 + 标题/元信息线 +
            标签胶囊 + 5 列选集格子；超过 3s 补一行「正在加载…（当前线路较慢）」。 */}
        {!detail && !err && (
          <div className="hg-detail-skel" aria-busy="true" aria-label="正在加载剧集详情">
            <div className="hg-detail-skel-hero">
              <span className="hg-detail-skel-poster shimmer" aria-hidden="true" />
              <span className="hg-detail-skel-lines" aria-hidden="true">
                <span className="hg-detail-skel-line shimmer" style={{ width: "78%" }} />
                <span className="hg-detail-skel-line shimmer" style={{ width: "42%" }} />
                <span className="hg-detail-skel-line shimmer" style={{ width: "58%" }} />
              </span>
            </div>
            {slow && <p className="hg-detail-skel-hint">正在加载…（当前线路较慢）</p>}
            <div className="hg-detail-skel-chips" aria-hidden="true">
              {[0, 1, 2].map(i => <span key={i} className="hg-detail-skel-chip shimmer" />)}
            </div>
            <div className="hg-ep-grid hg-detail-skel-grid" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => <span key={i} className="hg-detail-skel-cell shimmer" />)}
            </div>
          </div>
        )}

        {detail && (
          <>
            {/* 顶部宽幅区：模糊封面铺底 + 暗蒙层 + 3:4 原图不裁 + 剧名/评分/集数 */}
            <section className="hg-detail-hero" aria-label={detail.title}>
              <span className="hg-detail-hero-bg"><Img src={detail.cover} eager alt="" /></span>
              <span className="hg-detail-hero-veil" aria-hidden="true" />
              <div className="hg-detail-hero-row">
                <span className="hg-detail-poster"><Img src={detail.cover} eager alt={detail.title} /></span>
                <div className="hg-detail-head">
                  <h1 className="hg-detail-title">{detail.title}</h1>
                  {/* 元信息拆成两个不可再拆的组：放得下就一行，放不下只在两组之间换行，
                      不会出现「共」留在行尾、数字掉到下一行（报告 N-3.0-09） */}
                  <p className="hg-detail-meta">
                    <span>
                      {!!detail.score && <span className="hg-detail-score">{detail.score.toFixed(1)} 分</span>}
                      {!!detail.score && " · "}
                      {detail.is_finished ? "已完结" : `更新至 ${detail.episode_count || episodes.length} 集`}
                    </span>
                    <span>共 {detail.total_episodes || episodes.length} 集</span>
                  </p>
                </div>
              </div>
              {/* 点赞 / 收藏 / 评论：跨海报通栏一行（报告 12）。放在 head 里只有 160 多 px，
                  三组数字必然被切；推到整个宽幅区宽度后一行放得下，字号保持 12px 不缩。 */}
              <p className="hg-detail-counts">
                <span>点赞 {fmt(detail.counts?.like ?? 0)}</span>
                <span>·</span>
                <span>收藏 {fmt(Math.max(0, (detail.counts?.collect ?? 0) + favDelta))}</span>
                <span>·</span>
                <span>评论 {fmt(detail.counts?.comment ?? 0)}</span>
              </p>
            </section>

            {!!detail.tags?.length && (
              <div className="hg-detail-tags">
                {detail.tags.slice(0, 8).map(tag => (
                  <Button key={tag} card className="hg-tag-pill" onClick={() => push({ kind: "tag", tag, name: tag })}>
                    <span className="hg-tag-hash">#</span><span>{tag}</span>
                  </Button>
                ))}
              </div>
            )}

            {!!detail.description && (
              <section className="hg-section">
                <div className="hg-section-head"><h3 className="hg-section-title">简介</h3></div>
                <p className="hg-detail-desc">{detail.description}</p>
              </section>
            )}

            <section className="hg-section">
              <div className="hg-section-head">
                <h3 className="hg-section-title">选集</h3>
                <span className="hg-section-more">共 {episodes.length || detail.total_episodes || 0} 集</span>
              </div>
              {episodes.length === 0 && <p className="py-2 text-[12px] text-dim">暂无分集信息</p>}
              <div className="hg-ep-grid">
                {episodes.map(ep => {
                  const cur = (savedProg?.ep ?? 1) === ep.ep_num;
                  return (
                    <Button key={ep.ep_num} card className="hg-ep-cell" aria-current={cur ? "true" : undefined}
                      onClick={() => openPlayer(ep.ep_num)}>
                      {ep.ep_num}
                    </Button>
                  );
                })}
              </div>
            </section>

            {related.length > 0 && (
              <section className="hg-section">
                <div className="hg-section-head">
                  <h3 className="hg-section-title">相关推荐</h3>
                </div>
                <div className="hg-rail">
                  {related.slice(0, 12).map(v => (
                    <Button card key={v.id} className="hg-rail-card" onClick={() => push({ kind: "series", id: v.id })}>
                      <span className="hg-rail-art">
                        <Img src={v.cover} alt="" />
                        <span className="hg-rail-name">{v.title}</span>
                      </span>
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* 返回与右上角收藏按钮：对称悬浮于顶部宽幅区上方 */}
      <Button card className="hg-detail-back" aria-label="返回" onClick={onBack}><IBack size={22} /></Button>
      {detail && (
        <Button card disabled={favBusy} aria-pressed={faved} aria-label={faved ? "取消收藏" : "收藏剧集"}
          className={`hg-detail-fav${faved ? " is-on" : ""}`}
          onClick={toggleFav}>
          {faved ? <IStarF size={15} /> : <IStar size={15} />}
          <span>{faved ? "已收藏" : "收藏"}</span>
        </Button>
      )}

      {/* 底部智能续播主 CTA */}
      {detail && (
        <div className="shrink-0 hg-detail-cta-wrap">
          <Button card className="hg-cta" onClick={() => savedProg ? openPlayer(savedProg.ep, savedProg.t) : openPlayer(1)}>
            <IPlayF size={16} />
            <span>{savedProg ? `继续播放 · 第 ${savedProg.ep} 集` : "立即播放"}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
