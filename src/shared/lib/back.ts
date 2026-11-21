/** 全局返回拦截：面板等临时层优先消费，未消费则走导航栈。 */
type Handler = () => boolean;

let handler: Handler | null = null;
const overlays: { handle: Handler }[] = [];

/* 启动遮罩接管返回键（上游 4dd7844）：3.0.7 起 App 在动画期间就已经挂载（动画是盖在上面的
   不透明层），这时返回键会同时命中「跳过动画」和 App 自己的返回处理——后者在首页按下去
   直接 exit，表现就是「开屏按一下返回，应用没了」。所以遮罩期间把 runBack 短路成「已消费」，
   只让动画自己的监听把动画跳掉。引用计数是为了 StrictMode 的 mount→cleanup→mount：
   每次释放都是幂等的，不会把计数减成负数。 */
let startupHolds = 0;
export function holdBackForStartup(): () => void {
  startupHolds += 1;
  let released = false;
  return () => { if (!released) { released = true; startupHolds = Math.max(0, startupHolds - 1); } };
}

/** Dialogs can nest; dismiss the newest overlay before a player panel or page. */
export function registerOverlayBack(h: Handler) {
  const entry = { handle: h };
  overlays.push(entry);
  return () => { const index = overlays.indexOf(entry); if (index !== -1) overlays.splice(index, 1); };
}

export function setBackHandler(h: Handler | null) {
  handler = h;
}

/** 返回 true 表示已被消费（不再退栈） */
export function runBack(): boolean {
  // 启动遮罩盖着已挂载的 App：消费掉，但不碰浮层也不碰页面栈。
  if (startupHolds > 0) return true;
  // A handler can synchronously unregister itself. Snapshot registrations to avoid
  // calling another handler twice or dismissing an overlay opened during this event.
  for (const entry of [...overlays].reverse()) {
    if (!overlays.includes(entry)) continue;
    try {
      if (entry.handle()) return true;
    } catch {
      // A failed dialog close must not navigate away from the page beneath it.
      return true;
    }
  }
  try { return handler ? handler() : false; } catch { return false; }
}
