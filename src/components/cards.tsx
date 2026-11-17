import { fmt } from "../api";
import type { VideoCard } from "../types";
import { IHeartF, IPlayF, IStarF } from "../icons";
import { Img } from "./ui";
import { Button } from "./ios/controls";
import { FilteredContent } from "./FilteredContent";

function ScoreBadge({ score }: { score: number }) {
  return Number.isFinite(score) && score > 0 ? <span className="ios-score-badge" aria-label={`评分 ${score.toFixed(1)}`}>
    <IStarF size={12} />{score.toFixed(1)}
  </span> : null;
}

export function MediaCard({ title, cover, subtitle, badge, progress, score, priority = false, onOpen, blockedReason }: {
  title: string; cover: string; subtitle?: string; badge?: string; progress?: string; score?: number; priority?: boolean; onOpen: () => void; blockedReason?: string | null;
}) {
  if (blockedReason) return <Button onClick={onOpen} className="ios-poster" aria-label="该内容命中屏蔽标签，查看提示">
    <span className="ios-poster-art flex flex-col items-center justify-center gap-3 px-3 text-center text-mut">
      <span className="text-[14px] font-semibold">该内容命中屏蔽标签</span>
      <span className="text-[12px] break-words">{blockedReason}</span>
      <span className="text-[13px] text-primary">查看提示</span>
    </span>
    <span className="ios-poster-title">已屏蔽内容</span>
    {progress && <span className="ios-poster-subtitle">{progress}</span>}
  </Button>;
  return <Button onClick={onOpen} className="ios-poster" aria-label={title}>
    <span className={`ios-poster-art ${badge ? "has-poster-badge" : ""}`}>
      <Img src={cover} alt="" eager={priority} />
      {badge && <span className="ios-poster-badge">{badge}</span>}
      {typeof score === "number" && <ScoreBadge score={score} />}
      {progress && <span className="ios-poster-progress"><IPlayF size={12} />{progress}</span>}
      <span className="ios-poster-play" aria-hidden="true"><IPlayF size={23} /></span>
    </span>
    <span className="ios-poster-title">{title}</span>
    {subtitle && <span className="ios-poster-subtitle">{subtitle}</span>}
  </Button>;
}

export function WaterfallCard({ v, onOpen, priority = false }: { v: VideoCard; onOpen: () => void; priority?: boolean }) {
  return <MediaCard title={v.title} cover={v.cover} onOpen={onOpen} priority={priority} score={v.score}
    badge={v.is_finished ? "已完结" : `更新至 ${v.episode_count} 集`}
    subtitle={v.tags?.slice(0, 2).join(" · ") || v.author?.name || "HGuoX"}
    progress={`${fmt(v.hot)} 次播放`} />;
}

export function Masonry({ videos, onOpen, wide = false, scopeKey }: {
  videos: VideoCard[]; onOpen: (v: VideoCard) => void; wide?: boolean; gap?: string; scopeKey?: string | number;
}) {
  return <FilteredContent items={videos} scopeKey={scopeKey}>{visible => <div className={`ios-media-grid ${wide ? "is-wide" : ""}`} data-ui="media-grid">
    {visible.map((v, index) => <WaterfallCard key={v.id} v={v} priority={index < 2} onOpen={() => onOpen(v)} />)}
  </div>}</FilteredContent>;
}

export function RowCard({ v, onOpen }: { v: VideoCard; onOpen: () => void }) {
  return <div className="ios-row-card"><MediaCard title={v.title} cover={v.cover} score={v.score} onOpen={onOpen}
    badge={v.is_finished ? "完结" : `${v.episode_count} 集`}
    subtitle={v.score ? `${v.score.toFixed(1)} 分 · ${v.tags?.[0] || "短剧"}` : v.tags?.slice(0, 2).join(" · ")} />
  </div>;
}

export function RankRow({ item, onOpen, metricMax }: {
  item: { rank: number; video_id: number; title: string; cover: string; tags: string[]; score: number; metric_value: number; metric_label: string };
  onOpen: () => void; metricMax: number;
}) {
  /* v2 榜单行：大数字（ink 45）+ 83×119 竖版缩略图 + 标题 + 两行简介（标签）+ 热度 */
  return <Button className="hg-rank-row" onClick={onOpen}>
    <span className="hg-rank-no">{item.rank}</span>
    <span className="hg-rank-cover"><Img src={item.cover} /></span>
    <span className="hg-rank-copy">
      <span className="hg-rank-title">{item.title}</span>
      <span className="hg-rank-desc">{item.tags?.length ? item.tags.join(" · ") : item.metric_label}</span>
    </span>
    <span className="hg-rank-heat"><IHeartF size={12} />{fmt(item.metric_value)}</span>
  </Button>;
}
