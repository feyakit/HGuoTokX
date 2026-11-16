import { api, cover, playlist } from "../../api";
import type { Detail } from "../../types";

export type LoadedMedia = {
  detail: Detail;
  poster: string;
  url: string;
  error: string;
  episodes: number[];
};

const cache = new Map<string, Promise<LoadedMedia>>();

export function clearMediaCache() {
  cache.clear();
}

export function invalidateMedia(id: number, ep: number) {
  for (const key of [...cache.keys()]) {
    if (key.includes(`:${id}:${ep}:`)) cache.delete(key);
  }
}

function episodeList(detail: Detail) {
  if (detail.episodes?.length) return detail.episodes.map(item => item.ep_num);
  const total = Math.max(1, detail.episode_count || detail.total_episodes || 1);
  return Array.from({ length: total }, (_, index) => index + 1);
}

/** 同一集的详情和地址只请求一次，连续滑动时直接复用。 */
export function loadMedia(id: number, ep: number, hevc: boolean, epoch: number): Promise<LoadedMedia> {
  const key = `${epoch}:${id}:${ep}:${hevc ? 1 : 0}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const detail = await api.video(id);
      const poster = cover(detail.cover) || detail.cover || "";
      const episodes = episodeList(detail);
      try {
        const play = await api.play(id, ep);
        const raw = hevc && play.video_url_hevc ? play.video_url_hevc : play.video_url;
        return { detail, poster, url: raw ? playlist(raw) : "", error: raw ? "" : "没有可播放的地址", episodes };
      } catch (error) {
        return { detail, poster, url: "", error: error instanceof Error ? error.message : "播放失败", episodes };
      }
    })();
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}
