/**
 * Limit expensive glass layers while an HTML video is playing.
 * Uses capture listeners: media events do not bubble. Mutation observation is
 * enabled only while at least one playing video exists, so virtualized players
 * removed without pause() cannot leave the compositor stuck in playback mode.
 */
export function installGlassVideoActivity(): () => void {
  const root = document.documentElement;
  const playing = new Set<HTMLVideoElement>();
  const apply = () => {
    root.dataset.glassVideo = playing.size > 0 ? "playing" : "idle";
    if (playing.size > 0) observer.observe(document, { childList: true, subtree: true });
    else observer.disconnect();
  };
  const observer = new MutationObserver(() => {
    let stale = false;
    for (const video of playing) {
      if (!video.isConnected) { playing.delete(video); stale = true; }
    }
    if (stale) apply();
  });
  const onStart = (event: Event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected || video.paused || video.ended) return;
    playing.add(video);
    apply();
  };
  const onStop = (event: Event) => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    playing.delete(video);
    apply();
  };
  // Useful for WebViews that mount a player before the bootstrap is installed.
  for (const video of document.querySelectorAll("video")) {
    if (!video.paused && !video.ended) playing.add(video);
  }
  for (const event of ["play", "playing"]) document.addEventListener(event, onStart, true);
  for (const event of ["pause", "ended", "emptied", "abort", "error"]) document.addEventListener(event, onStop, true);
  const onVisibility = () => {
    // Some WebViews suspend video without a reliable pause event.
    for (const video of playing) {
      if (video.paused || video.ended || !video.isConnected) playing.delete(video);
    }
    apply();
  };
  document.addEventListener("visibilitychange", onVisibility);
  apply();
  return () => {
    for (const event of ["play", "playing"]) document.removeEventListener(event, onStart, true);
    for (const event of ["pause", "ended", "emptied", "abort", "error"]) document.removeEventListener(event, onStop, true);
    document.removeEventListener("visibilitychange", onVisibility);
    observer.disconnect();
    playing.clear();
    delete root.dataset.glassVideo;
  };
}
