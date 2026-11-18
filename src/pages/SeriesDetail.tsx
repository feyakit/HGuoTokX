import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmt } from "../api";
import { useStore } from "../store";
import { Button } from "../components/ios/controls";
import { Img } from "../components/ui";
import { Loader } from "../components/ios/effects";
import { IBack, IPlayF } from "../icons";
import type { Detail, VideoCard } from "../types";

/* 详情页（自定屏，依据 /opt/data/hguox-redesign/设计规范-自定屏.md）：
   顶部宽幅区 332×281 / 圆角 15：同张封面模糊放大铺底 + 暗蒙层，上面放 3:4 原比例封面（不裁）+ 剧名/评分/集数；
   下面依次是标签胶囊、简介、选集（5 列 56×56）、相关推荐；底部主 CTA 332×41.7 全圆、距底 32。
   颜色只用 v3 六色：--p-bg / --hg-surface / accent / #8B9AF9 / #fff / rgba(255,255,255,.58)。 */
export default function SeriesDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { push, lineEpoch, history } = useStore();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [related, setRelated] = useState<VideoCard[]>([]);
  const [err, setErr] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    setErr("");
    api.video(id)
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

  const openPlayer = (ep?: number) => {
    if (!detail) return;
    push({
      kind: "feed",
      videoIds: [detail.id],
      index: 0,
      title: detail.title,
      startEp: ep && ep > 0 ? ep : 1,
    });
  };

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />

      <div className="flex-1 scroll-y pb-6 relative z-10">
        {err && <p role="alert" className="py-6 text-center text-[12px] text-danger">{err}</p>}
        {!detail && !err && <div className="flex justify-center py-10"><Loader className="w-6 h-6 spinner" /></div>}

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
                  <p className="hg-detail-meta">
                    {!!detail.score && <span className="hg-detail-score">{detail.score.toFixed(1)} 分</span>}
                    {!!detail.score && " · "}
                    {detail.is_finished ? "已完结" : `更新至 ${detail.episode_count || episodes.length} 集`}
                    {" · 共 "}{detail.total_episodes || episodes.length}{" 集"}
                  </p>
                  <p className="hg-detail-counts">
                    {/* 报告 12：每项单独 nowrap，数字不会和标签被拆到两行 */}
                    <span>点赞 {fmt(detail.counts?.like ?? 0)}</span>
                    <span>·</span>
                    <span>收藏 {fmt(detail.counts?.collect ?? 0)}</span>
                    <span>·</span>
                    <span>评论 {fmt(detail.counts?.comment ?? 0)}</span>
                  </p>
                </div>
              </div>
            </section>

            {!!detail.tags?.length && (
              <div className="hg-detail-tags">
                {detail.tags.slice(0, 8).map(tag => (
                  <Button key={tag} card className="hg-detail-tag" onClick={() => push({ kind: "tag", tag, name: tag })}>{tag}</Button>
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
                  /* 当前集 = 观看记录里的进度集；没有记录时默认第 1 集（规范要求「当前播放集中态」） */
                  const cur = (history.find(h => String(h.id) === String(detail?.id))?.ep ?? 1) === ep.ep_num;
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

      {/* 返回：40×40 圆、距顶 12（含安全区）/ 距左 14，压在宽幅区上 */}
      <Button card className="hg-detail-back" aria-label="返回" onClick={onBack}><IBack size={22} /></Button>

      {/* 底部主 CTA：332×41.7 全圆、距底 32。放在 flex 列里而不是悬浮，
          这样内容区永远不会被它盖住（滚到底能看全） */}
      {detail && (
        <div className="shrink-0 hg-detail-cta-wrap">
          <Button card className="hg-cta" onClick={() => openPlayer(1)}>
            <IPlayF size={16} /><span>播放</span>
          </Button>
        </div>
      )}
    </div>
  );
}
