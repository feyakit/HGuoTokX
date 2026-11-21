/**
 * 只用于显示的文本收窄工具（不影响任何实际 URL）。
 *
 * 为什么需要：安卓 Roboto/Noto 比 iOS 字宽 3–6%，同一个域名在 iOS 一行放得下、
 * 安卓就折到第二行。`font-family` 抹不平这个差，只能靠 nowrap + 省略；
 * 而域名用尾部省略会看不出是哪条线路（尾缀往往是识别点），所以中间省略。
 */

/** 中间省略：保留首尾，例 `zju.dvygahpw.cc` → `zju…pw.cc` */
export function middleEllipsis(text: string, max = 22): string {
  const value = (text || "").trim();
  if (!value || value.length <= max) return value;
  const keepTail = Math.max(4, Math.floor(max * 0.45));
  const keepHead = Math.max(2, max - keepTail - 1);
  return `${value.slice(0, keepHead)}…${value.slice(-keepTail)}`;
}

/** 尾部省略（给不适合中间省略的普通文案用） */
export function tailEllipsis(text: string, max = 32): string {
  const value = (text || "").trim();
  return value.length <= max ? value : `${value.slice(0, Math.max(2, max - 1))}…`;
}
