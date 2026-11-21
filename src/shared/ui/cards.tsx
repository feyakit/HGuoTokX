import { fmt } from "../api/api";
import type { VideoCard } from "../api/types";
import { IHeartF, IPlayF } from "./icons";
import { Img } from "./ui";
import { Button } from "./ios/controls";
import { FilteredContent } from "./FilteredContent";

export function MediaCard({ title, cover, subtitle, badge, progress, priority = false, onOpen, blockedReason }: {
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

export function RankRow({ item, onOpen }: {
  item: { rank: number; video_id: number; title: string; cover: string; tags: string[]; score: number; cate_name?: string; episode_count?: number; is_finished?: boolean; metric_value: number; metric_label: string };
  onOpen: () => void; metricMax?: number;
}) {
  const rankTier = item.rank === 1 ? "is-first" : item.rank === 2 ? "is-second" : item.rank === 3 ? "is-third" : "";
  const summary = [
    item.cate_name,
    item.is_finished ? "已完结" : item.episode_count ? `更新至 ${item.episode_count} 集` : "",
    item.metric_label,
  ].filter(Boolean).join(" · ");
  return <Button card className="hg-rank-row" onClick={onOpen}>
    <span className={`hg-rank-no ${rankTier}`}>{item.rank}</span>
    <span className="hg-rank-cover"><Img src={item.cover} /></span>
    <span className="hg-rank-copy">
      <span className="hg-rank-title">{item.title}</span>
      {!!item.tags?.length && (
        <span className="hg-rank-tags">
          {item.tags.slice(0, 3).map(t => <span key={t} className="hg-rank-tag">{t}</span>)}
        </span>
      )}
      <span className="hg-rank-desc">{summary}</span>
    </span>
  </Button>;
}
