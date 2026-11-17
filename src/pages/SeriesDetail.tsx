import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmt } from "../api";
import { useStore } from "../store";
import { Button } from "../components/ios/controls";
import { Img } from "../components/ui";
import { Loader } from "../components/ios/effects";
import { IBack, IPlayF } from "../icons";
import type { Detail } from "../types";

/** 剧集详情页：大封面（3:4 源图完整展示）+ 标题/评分/集数/tags + 简介 + 底部「播放」+ 集数网格 */
export default function SeriesDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { push, lineEpoch } = useStore();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    setErr("");
    api.video(id)
      .then(res => { if (my === seq.current) setDetail(res); })
      .catch(e => { if (my === seq.current) setErr((e as Error)?.message || "加载失败"); });
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

      <header className="shrink-0 flex items-center gap-2 px-4 pt-1 pb-2 relative z-10">
        <Button className="ios-icon-button" aria-label="返回" onClick={onBack}><IBack size={18} /></Button>
        <h1 className="text-[16px] font-bold text-on truncate">剧集详情</h1>
      </header>

      <div className="flex-1 scroll-y px-4 pb-[calc(96px+var(--sab,0px))] relative z-10">
        {err && <p role="alert" className="py-6 text-center text-[12px] text-danger">{err}</p>}
        {!detail && !err && <div className="flex justify-center py-10"><Loader className="w-6 h-6 spinner" /></div>}

        {detail && (
          <>
            {/* 大封面：数据封面本体就是 3:4，这里 1:1 照原比例展示，不裁 */}
            <div className="flex gap-3 items-start">
              <div className="hg-detail-cover">
                <Img src={detail.cover} eager alt={detail.title} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[18px] font-bold leading-tight text-on">{detail.title}</h2>
                <p className="mt-2 text-[12px] text-mut">
                  {!!detail.score && <span className="text-amber font-semibold">{detail.score.toFixed(1)} 分</span>}
                  {!!detail.score && " · "}
                  {detail.is_finished ? "已完结" : `更新至 ${detail.episode_count || episodes.length} 集`}
                  {" · "}共 {detail.total_episodes || episodes.length} 集
                </p>
                <p className="mt-1 text-[11px] text-dim">
                  点赞 {fmt(detail.counts?.like ?? 0)} · 收藏 {fmt(detail.counts?.collect ?? 0)} · 评论 {fmt(detail.counts?.comment ?? 0)}
                </p>
                {!!detail.tags?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.tags.slice(0, 6).map(tag => (
                      <Button key={tag} className="hg-tag-chip" onClick={() => push({ kind: "tag", tag, name: tag })}>{tag}</Button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {!!detail.description && (
              <section className="hg-section">
                <div className="hg-section-head"><h3 className="hg-section-title">简介</h3></div>
                <p className="text-[13px] leading-[1.65] text-mut whitespace-pre-wrap">{detail.description}</p>
              </section>
            )}

            <section className="hg-section">
              <div className="hg-section-head">
                <h3 className="hg-section-title">选集</h3>
                <span className="hg-section-more">共 {episodes.length || detail.total_episodes || 0} 集</span>
              </div>
              {episodes.length === 0 && <p className="py-2 text-[12px] text-dim">暂无分集信息</p>}
              <div className="hg-ep-grid">
                {episodes.map(ep => (
                  <Button key={ep.ep_num} className="hg-ep-cell" onClick={() => openPlayer(ep.ep_num)}>
                    {ep.ep_num}
                  </Button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* 底部主 CTA：整条宽度、固定在下沿（安全区内） */}
      {detail && (
        <div className="shrink-0 px-4 pb-[calc(12px+var(--sab,0px))] pt-2 relative z-10">
          <Button className="hg-cta" onClick={() => openPlayer(1)}>
            <IPlayF size={16} /><span>播放</span>
          </Button>
        </div>
      )}
    </div>
  );
}
