import { fmtTime } from "../api/api";
import type { Detail } from "../api/types";
import type { WatchProgress } from "./store";

/**
 * 收藏的「看到哪 / 还有几集没看」（上游 #153 / `d6110b3`）。
 *
 * 全部是纯函数：数据只有两处来源——本地观看记录 `history`，和本地基线 `favEpCounts`
 * （收藏那一刻或上次点开时这部剧更新到第几集）。不发任何请求，也就不存在「拿不到就编」的问题：
 * 没有详情、没有基线时一律返回空/0，界面就少显示一行。
 */

/** 这部剧的「最新集数」：优先详情里的集数与集列表，其次 0。 */
export function detailEpisodeCount(detail: Pick<Detail, "episode_count" | "episodes"> | null | undefined): number {
  if (!detail) return 0;
  const fromList = Array.isArray(detail.episodes)
    ? detail.episodes.reduce((max, ep) => Math.max(max, Number(ep.ep_num) || 0), detail.episodes.length)
    : 0;
  return Math.max(0, Number(detail.episode_count) || 0, fromList);
}

/** 这一集是否已经看完（留 3 秒余量：片尾字幕/推荐位不算没看完）。 */
export function isEpisodeFinished(progress: WatchProgress | undefined): boolean {
  return !!progress && progress.dur > 0 && progress.t >= Math.max(1, progress.dur - 3);
}

/**
 * 点「继续观看」应该从哪一集、哪一秒起。
 * 上次那集已看完 → 下一集从 0 开始；没看完 → 原集原时间。
 */
export function resolveResumeTarget(
  detail: Detail | undefined,
  progress: WatchProgress | undefined,
): { startEp?: number; startTime?: number } {
  if (!progress) return {};
  if (isEpisodeFinished(progress)) {
    const latest = detailEpisodeCount(detail);
    const nextFromList = detail?.episodes
      ?.map(ep => Number(ep.ep_num) || 0)
      .filter(ep => ep > progress.ep)
      .sort((a, b) => a - b)[0];
    const nextEp = nextFromList ?? (latest > progress.ep ? progress.ep + 1 : undefined);
    if (nextEp && nextEp > progress.ep) return { startEp: nextEp, startTime: 0 };
    return { startEp: progress.ep, startTime: 0 };
  }
  return { startEp: progress.ep, startTime: progress.t >= 1 ? progress.t : undefined };
}

/** 卡片下方那行进度文案。 */
export function formatWatchProgress(
  progress: WatchProgress | undefined,
  latestCount: number,
  isFinished: boolean,
): string | undefined {
  if (!progress) return undefined;
  if (isEpisodeFinished(progress)) {
    if (isFinished && latestCount > 0 && progress.ep >= latestCount) return `已看完 · 全 ${latestCount} 集`;
    return `已看完第 ${progress.ep} 集`;
  }
  return progress.t >= 1 ? `第 ${progress.ep} 集 · ${fmtTime(progress.t)}` : `第 ${progress.ep} 集`;
}

/**
 * 还有几集是「新更但我没看」的。三种情形：
 * 1. 有基线（收藏时/上次点开时记下的集数）→ 最新 − max(基线, 已看集)；
 * 2. 没基线但看过、且这集已看完 → 最新 − 已看集；
 * 3. 其余（没看过、或看到一半）→ 0，宁可不报也不误报。
 */
export function unwatchedNewEpisodes(
  detail: Detail,
  progress: WatchProgress | undefined,
  knownCount: number | undefined,
): number {
  const latest = detailEpisodeCount(detail);
  if (latest <= 0) return 0;
  const watchedEp = progress?.ep ?? 0;
  if (watchedEp >= latest) return 0;
  if (knownCount !== undefined && knownCount > 0) {
    return Math.max(0, latest - Math.max(knownCount, watchedEp));
  }
  if (progress && !detail.is_finished && (isEpisodeFinished(progress) || progress.t === 0)) {
    return Math.max(0, latest - watchedEp);
  }
  return 0;
}
