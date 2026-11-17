import EpisodePlayer, { type EpisodePlayerProps } from "./EpisodePlayer";

/**
 * 播放页壳：只负责把 videoId / 起始集数交给 EpisodePlayer，并处理返回。
 * 播放内核、控制层、进度、清晰度、锁屏都在 EpisodePlayer 里。
 */
export default function Feed(props: EpisodePlayerProps) {
  return <EpisodePlayer {...props} />;
}
