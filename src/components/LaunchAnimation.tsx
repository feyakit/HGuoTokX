import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { addPluginListener } from "@tauri-apps/api/core";
import { platform } from "../api";
import "../styles/launch.css";
import UsageAgreement from "./UsageAgreement";
import { hasAcceptedAgreement } from "../usageAgreement";

// One reveal per WebView lifetime, including StrictMode and subsequent App remounts.
let launchCompleted = false;
export const LAUNCH_DURATION = 2200;

/** HGuoTokX shared H-play identity with spring-animated strokes. */
export function LaunchAnimation({ onFinish }: { onFinish: () => void }) {
  const gradient = useId();
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

  return <div className="hg-launch" role="dialog" aria-modal="true" aria-label="HGuoTokX 启动动画"
    onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === "launch-exit") finish(); }}>
    <div className="hg-launch-stage" aria-hidden="true">
      <div className="hg-launch-orbit" />
      <div className="hg-launch-mark">
        <svg className="hg-launch-svg" viewBox="0 0 64 64" fill="none">
          <defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#78D8FF" /><stop offset=".54" stopColor="#7977FF" />
            <stop offset="1" stopColor="#F28ACF" />
          </linearGradient></defs>
          <g className="hg-launch-tile">
            <rect width="64" height="64" rx="15" fill={`url(#${gradient})`} />
            <path d="M1 16Q24 1 48 12" stroke="white" strokeOpacity=".26" strokeWidth="2" />
          </g>
          <g stroke="white" strokeWidth="8" strokeLinecap="round">
            <path className="hg-launch-stroke hg-launch-left" d="M18 16V48" />
            <path className="hg-launch-stroke hg-launch-bridge" d="M18 32H44" />
            <path className="hg-launch-stroke hg-launch-right" d="M44 16V48" />
          </g>
          <path className="hg-launch-play" d="M31 24L48 33L31 42Z" fill="white" />
        </svg>
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
