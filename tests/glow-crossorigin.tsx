import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import VideoSurface from "../src/features/playback/VideoSurface";
import "../src/index.css";

// W47 报的真 bug 的探针：安卓上页面源是 http://tauri.localhost、媒体走 http://hg.localhost,
// 是跨源。不开微光时无所谓；开微光要 drawImage 采像素，跨源且没 crossOrigin → canvas 污染
// → SecurityError → AmbientGlow 直接停掉，表现就是「微光静默不生效」。
//
// 这里两件事一起验：
//   ① 组件层：开微光的 <video> 必须带 crossOrigin="anonymous"（关掉时不能带，避免无谓的 CORS 预检）；
//   ② 机制层：真跨源（同机不同端口）条件下，带 crossOrigin + 回 ACAO 能 getImageData，
//      不带 crossOrigin 就必然 SecurityError —— 这条证明"只是加属性"确实能修，而 Rust 侧
//      lib.rs 的 custom protocol 已按请求 Origin 回 ACAO（无 Origin 时回 *）。

Object.assign(window, {
  isTauri: true,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return 0; },
    unregisterCallback() {},
    invoke() { return Promise.resolve(null); },
  },
});

/* ② 机制探针：把 <video crossorigin> 指向另一个源，画到 canvas 上取样。 */
async function probeCrossOrigin(src: string, anonymous: boolean) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = "position:fixed;left:-9999px;width:160px;height:90px";
  if (anonymous) video.crossOrigin = "anonymous";
  video.src = src;
  document.body.appendChild(video);
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("video error"));
      setTimeout(() => reject(new Error("video timeout")), 8000);
    });
    await video.play().catch(() => {});
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 18;
    const context = canvas.getContext("2d", { alpha: false })!;
    context.drawImage(video, 0, 0, 32, 18);
    const data = context.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
    return { ok: true, sum };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.name || error) };
  } finally {
    video.remove();
  }
}

function Harness() {
  useEffect(() => {
    const src = new URLSearchParams(location.search).get("media") || "";
    void (async () => {
      Object.assign(window, {
        glowProbe: {
          withCrossOrigin: src ? await probeCrossOrigin(src, true) : null,
          withoutCrossOrigin: src ? await probeCrossOrigin(src, false) : null,
        },
      });
    })();
  }, []);
  return (
    <div>
      <VideoSurface data-glow="on" src="https://fixture.invalid/a.m3u8" ambientGlow active={false} muted />
      <VideoSurface data-glow="off" src="https://fixture.invalid/b.m3u8" active={false} muted />
    </div>
  );
}

createRoot(document.querySelector("#root")!).render(<Harness />);
