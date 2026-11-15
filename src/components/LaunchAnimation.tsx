import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { addPluginListener } from "@tauri-apps/api/core";
import { platform } from "../api";
import "../styles/launch.css";
import UsageAgreement from "./UsageAgreement";
import { hasAcceptedAgreement } from "../usageAgreement";

// One reveal per WebView lifetime, including StrictMode and subsequent App remounts.
let launchCompleted = false;
export const LAUNCH_DURATION = 2200;

/** HGuoX shared dark neon X-play identity, honoring reduced motion. */
export function LaunchAnimation({ onFinish }: { onFinish: () => void }) {
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const complete = useRef(false);
  const finish = useCallback(() => {
    if (complete.current) return;
    complete.current = true;
    finishRef.current();
  }, []);

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setTimeout(finish, motion.matches ? 200 : LAUNCH_DURATION + 120);
    const onMotion = () => { if (motion.matches) finish(); };
    const onHidden = () => { if (document.visibilityState === "hidden") finish(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(); }
    };
    motion.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("keydown", onKey, true);
    onHidden();
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [finish]);

  useEffect(() => {
    if (platform !== "android") return;
    let disposed = false;
    let listener: { unregister: () => Promise<void> } | undefined;
    void addPluginListener("app", "back-button", finish).then(handle => {
      if (disposed) void handle.unregister().catch(() => {});
      else listener = handle;
    }).catch(() => {});
    return () => { disposed = true; void listener?.unregister().catch(() => {}); };
  }, [finish]);

  return <div className="hg-launch" role="dialog" aria-modal="true" aria-label="HGuoX 启动动画"
    onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === "launch-exit") finish(); }}>
    <div className="hg-launch-stage" aria-hidden="true">
      <div className="hg-launch-orbit" />
      <div className="hg-launch-mark">
        <img className="hg-launch-svg hg-launch-logo" src="/logo.svg"
          width="152" height="152" alt="" draggable={false} decoding="async" />
      </div>
      <div className="hg-launch-wordmark"><span>HGuoTok</span><span className="hg-launch-word-x">X</span></div>
    </div>
    <span className="hg-launch-footnote" aria-hidden="true">PRESS PLAY. FEEL MORE.</span>
  </div>;
}

/** Children mount only after the reveal and an explicitly accepted current agreement. */
export default function StartupGate({ children }: { children: ReactNode }) {
  const [finished, setFinished] = useState(() => launchCompleted);
  const [agreed, setAgreed] = useState(() => hasAcceptedAgreement());
  const finish = useCallback(() => { launchCompleted = true; setFinished(true); }, []);
  if (!finished) return <LaunchAnimation onFinish={finish} />;
  if (!agreed) return <UsageAgreement onAccept={() => setAgreed(true)} />;
  return children;
}
