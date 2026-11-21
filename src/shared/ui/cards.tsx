import { fmt } from "../api/api";
import type { VideoCard } from "../api/types";
import { ICheck, IHeartF, IPlayF } from "./icons";
import { Img } from "./ui";
import { Button } from "./ios/controls";
import { FilteredContent } from "./FilteredContent";
import { useLongPress } from "../lib/useLongPress";

export function MediaCard({ title, cover, subtitle, badge, badgeTone = "default", progress, priority = false, onOpen, blockedReason, onLongPress, selectionMode = false, selected = false }: {
  title: string; cover: string; subtitle?: string; badge?: string; progress?: string; score?: number; priority?: boolean; onOpen: () => void; blockedReason?: string | null;
  badgeTone?: "default" | "update"; onLongPress?: () => void; selectionMode?: boolean; selected?: boolean;
}) {
  /* 多选入口（上游 #168）：长按或电脑右键进入，长按余波的那次 click 要吞掉。 */
  const { longPressProps, consumeSuppressedClick } = useLongPress(onLongPress);
  const open = () => {
    if (consumeSuppressedClick()) return;
    onOpen();
  };
  const selection = selectionMode
    ? <span className="ios-poster-select" aria-hidden="true">{selected && <ICheck size={16} strokeWidth={2.4} />}</span>
    : null;
  const className = `ios-poster${onLongPress ? " has-long-press" : ""}${selected ? " is-selected" : ""}`;
  const ariaLabel = selectionMode ? `${selected ? "取消选择" : "选择"}${title}` : title;
  const pressed = selectionMode ? selected : undefined;

  if (blockedReason) return <Button onClick={open} className={className}
    aria-label={selectionMode ? ariaLabel : "该内容命中屏蔽标签，查看提示"} aria-pressed={pressed} {...longPressProps}>
    <span className="ios-poster-art flex flex-col items-center justify-center gap-3 px-3 text-center text-mut">
      <span className="text-[14px] font-semibold">该内容命中屏蔽标签</span>
      <span className="text-[12px] break-words">{blockedReason}</span>
      <span className="text-[13px] text-primary">查看提示</span>
      {selection}
    </span>
    <span className="ios-poster-title">已屏蔽内容</span>
    {progress && <span className="ios-poster-subtitle">{progress}</span>}
  </Button>;
  return <Button onClick={open} className={className} aria-label={ariaLabel} aria-pressed={pressed} {...longPressProps}>
    <span className={`ios-poster-art ${badge ? "has-poster-badge" : ""}`}>
      <Img src={cover} alt="" eager={priority} />
      {badge && <span className={`ios-poster-badge${badgeTone === "update" ? " is-update" : ""}`}>{badge}</span>}
      {progress && <span className="ios-poster-progress"><IPlayF size={12} />{progress}</span>}
      <span className="ios-poster-play" aria-hidden="true"><IPlayF size={23} /></span>
      {selection}
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
