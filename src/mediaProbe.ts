/**
 * 「这个内核能不能跑 hls.js」——比 Hls.isSupported() 便宜的等价判据。
 *
 * 为什么不用 `Hls.isSupported()`：hls.js 是 ~500KB 的重依赖，只要入口链路静态 import 它，
 * 冷启第一帧之前就要先把这 500KB 求值完（x86 云机上实测入口 chunk 1.03MB，其中一半以上是它）。
 * 启动日志和设置页只需要一个 yes/no，用 MediaSource 能力探测即可，口径与 hls.js 一致：
 * 有 MediaSource（或 ManagedMediaSource）且能播 avc1 + mp4a 的 fMP4。
 * 真正播放时仍然走 hls.js 自己的 isSupported()（播放器 chunk 里才加载）。
 */
export function mseHlsSupported(): boolean {
  try {
    const scope = window as Window & {
      MediaSource?: { isTypeSupported?: (type: string) => boolean };
      ManagedMediaSource?: { isTypeSupported?: (type: string) => boolean };
    };
    const source = scope.MediaSource || scope.ManagedMediaSource;
    if (!source?.isTypeSupported) return false;
    return [
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
      'audio/mp4;codecs="mp4a.40.2"',
    ].some((type) => {
      try { return source.isTypeSupported!(type); } catch { return false; }
    });
  } catch {
    return false;
  }
}
