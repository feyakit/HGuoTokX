/**
 * 需要 hls.js **运行期值**的诊断（事件名、错误类型）。
 *
 * 单独成文件的原因：`tauri android build` 里入口 chunk 会在冷启第一帧前求值，
 * 而 hls.js 是 ~500KB 的重依赖。playbackDiagnostics.ts 只引类型，
 * 这里被播放器链路（EpisodePlayer → VideoSurface / Player）静态引用，
 * 于是 hls.js 只会进播放器 chunk，首屏不再为它付解析成本。
 */
import Hls, { type FragBufferedData, type FragLoadedData, type FragLoadingData } from "hls.js";
import { mediaHost, mediaResource, noteHlsVersion, playbackLogEnabled, setEngine } from "./playbackDiagnostics";

type Data = Record<string, unknown>;

noteHlsVersion(Hls.version);

export function observeHls(hls: Hls, trace: (event: string, data?: Data) => void) {
  hls.on(Hls.Events.MEDIA_ATTACHED, (_event, data) => {
    const source = data.mediaSource;
    setEngine(hls, source?.constructor.name || "MediaSource");
    trace("hls.attached", { engine: source?.constructor.name || "MediaSource", prefer_managed: hls.config.preferManagedMediaSource });
    if (source) {
      const start = () => trace("mms.startstreaming");
      const end = () => trace("mms.endstreaming");
      source.addEventListener("startstreaming", start);
      source.addEventListener("endstreaming", end);
      hls.once(Hls.Events.DESTROYING, () => { source.removeEventListener("startstreaming", start); source.removeEventListener("endstreaming", end); });
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => trace("hls.manifest", { levels: hls.levels.length }));
  for (const event of [Hls.Events.FRAG_LOADING, Hls.Events.FRAG_LOADED, Hls.Events.FRAG_BUFFERED, Hls.Events.FRAG_LOAD_EMERGENCY_ABORTED] as const) {
    hls.on(event, (_event: string, data: FragLoadingData | FragLoadedData | FragBufferedData) => {
      if (!playbackLogEnabled()) return;
      const { frag } = data;
      const loading = frag.stats.loading;
      trace(event, { resource: mediaResource(frag.url), host: mediaHost(frag.url), fragment: frag.sn, start: round(frag.start), duration: round(frag.duration), bytes: frag.stats.loaded,
        load_ms: loading.end > 0 && loading.end >= loading.start ? round(loading.end - loading.start) : null,
        first_byte_ms: loading.first > 0 && loading.first >= loading.start ? round(loading.first - loading.start) : null });
    });
  }
  hls.on(Hls.Events.ERROR, (_event, data) => trace("hls.error", { type: data.type, detail: data.details, fatal: data.fatal, status: data.response?.code,
    fragment: data.frag?.sn, resource: data.frag ? mediaResource(data.frag.url) : undefined, host: data.frag ? mediaHost(data.frag.url) : undefined }));
}

const round = (n: number) => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
