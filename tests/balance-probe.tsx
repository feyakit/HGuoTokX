/**
 * 「平衡音量」探针（POC 用，上游 #197 的思路）：
 * 不碰真实网络，用一段自己生成的 WAV（前 10 秒很轻、之后很响）挂上同一条 Web Audio 链，
 * 量三个数：安静段输出、响段输出、把元素音量压到 0.2 后输出。
 *
 * 判据：两段输出应被拉到同一响度（差 ≤1.5dB）；手动音量仍然生效（压到 0.2 应明显变小）。
 * 只是探针：不进 App 打包（tests/ 只在 vite dev 里跑）。
 */
import { getBalanceVolumeMetrics, setBalanceVolume, isBalanceVolumeSupported } from "../src/features/playback/balanceVolume";

function fixtureWav(seconds = 24, sampleRate = 22050): string {
  const frames = sampleRate * seconds;
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i += 1) {
    /* 前 10 秒 ≈ -38dBFS，之后 ≈ -2dBFS：模拟「前情提要 vs 正片」的响度差 */
    const amplitude = i < sampleRate * 10 ? 0.012 : 0.8;
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude;
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), true);
  }
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/* 产品里只有 <video>，链条的类型也是 HTMLVideoElement：这里同样用 video 元素（WAV 有声无画）。 */
const el = document.createElement("video");
el.id = "probe";
el.preload = "auto";
document.body.appendChild(el);

const out = document.getElementById("results") as HTMLPreElement;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function measure(atSecond: number) {
  el.currentTime = atSecond;
  await el.play();
  await wait(4500);
  const metrics = getBalanceVolumeMetrics(el);
  return metrics;
}

(window as unknown as Record<string, unknown>).__balanceProbe = {
  supported: () => isBalanceVolumeSupported(),
  state: () => getBalanceVolumeMetrics(el)?.state ?? "off",
  /** 跨源且没有 CORS 的地址必须判 opaque，绝不能挂链条（挂了就是整片无声）。 */
  checkOpaqueGuard: (crossOriginUrl: string) => {
    const probe = document.createElement("video");
    probe.src = crossOriginUrl;
    setBalanceVolume(probe, true);
    return probe.dataset.balanceVolume ?? "off";
  },
  load: (src: string) => { el.src = src; },
  /** 生成内置样例（前 10 秒轻、之后响）并装载。 */
  loadFixture: () => { el.src = fixtureWav(); },
  isStarted: () => (getBalanceVolumeMetrics(el)?.state ?? "off") === "on",
  seek: (t: number) => { el.currentTime = t; },
  setVolume: (v: number) => { el.volume = v; },
  metrics: () => getBalanceVolumeMetrics(el),
  run: async () => {
    setBalanceVolume(el, true);
    const quiet = await measure(3);
    const loud = await measure(12);
    el.volume = 0.2;
    await wait(2500);
    const lowered = getBalanceVolumeMetrics(el);
    const report = {
      quietDb: quiet?.outputDb, loudDb: loud?.outputDb, loweredDb: lowered?.outputDb,
      quietDesired: quiet?.desiredDb, loudDesired: loud?.desiredDb,
      quietPeakDb: quiet?.outputPeakDb, loudPeakDb: loud?.outputPeakDb,
    };
    out.textContent = JSON.stringify(report, null, 2);
    return report;
  },
};

out.textContent = `支持：${isBalanceVolumeSupported()}`;
document.getElementById("start")?.addEventListener("click", () => { void (window as unknown as { __balanceProbe: { run: () => Promise<unknown> } }).__balanceProbe.run(); });
