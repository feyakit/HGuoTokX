/**
 * On-demand WebView UI cadence probe. Not a GPU, battery or video FPS
 * benchmark. Nothing runs until the user explicitly requests a sample.
 */
export type GlassFrameAssessment = {
  status: "smooth" | "stutter" | "inconclusive";
  frameCount: number;
  medianMs: number;
  p95Ms: number;
  longFrameRatio: number;
};

export function assessGlassFrames(intervals: readonly number[]): GlassFrameAssessment {
  const clean = intervals.filter(ms => Number.isFinite(ms) && ms > 0 && ms < 10000).sort((a,b) => a-b);
  const count = clean.length;
  if (count < 8) {
    return { status: "inconclusive", frameCount: count, medianMs: 0, p95Ms: 0, longFrameRatio: 0 };
  }
  const quantile = (fraction: number) => clean[Math.min(count-1, Math.ceil(fraction*count)-1)];
  const median = quantile(.5);
  const p95 = quantile(.95);
  const long = clean.filter(ms => ms > 50).length / count;
  return {
    status: p95 >= 80 || long >= .12 ? "stutter" : "smooth",
    frameCount: count,
    medianMs: Math.round(median*10)/10,
    p95Ms: Math.round(p95*10)/10,
    longFrameRatio: Math.round(long*100)/100,
  };
}

export function measureGlassFrameCadence(options: {
  frames?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
} = {}): Promise<GlassFrameAssessment> {
  if (document.hidden) return Promise.reject(new Error("请在应用前台进行检测"));
  if (options.signal?.aborted) return Promise.reject(new Error("检测已取消"));
  const target = Math.max(12, Math.min(180, Math.floor(options.frames ?? 72)));
  const maxDuration = Math.max(1200, Math.min(8000, options.timeoutMs ?? 5500));
  return new Promise((resolve, reject) => {
    const intervals: number[] = [];
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let previous: number | undefined;
    let complete = false;
    const cleanup = () => {
      cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", hidden);
      options.signal?.removeEventListener("abort", aborted);
    };
    const finish = (error?: Error) => {
      if (complete) return;
      complete = true;
      cleanup();
      if (error) reject(error);
      else resolve(assessGlassFrames(intervals));
    };
    const hidden = () => { if (document.hidden) finish(new Error("窗口已切到后台，请返回前台重试")); };
    const aborted = () => finish(new Error("检测已取消"));
    const sample: FrameRequestCallback = stamp => {
      if (complete) return;
      if (previous !== undefined) intervals.push(stamp-previous);
      previous = stamp;
      if (intervals.length >= target) finish();
      else frame = requestAnimationFrame(sample);
    };
    document.addEventListener("visibilitychange", hidden);
    options.signal?.addEventListener("abort", aborted);
    timeout = setTimeout(() => finish(new Error("采样超时，请关闭其他高负载任务后重试")), maxDuration);
    frame = requestAnimationFrame(sample);
  });
}
