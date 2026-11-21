import { Children, forwardRef, type FocusEvent as ReactFocusEvent, type ButtonHTMLAttributes, type CSSProperties, type FormHTMLAttributes, type HTMLAttributes, type ImgHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** 卡片型按钮：跳过 .ios-button 的 44px 触控最小尺寸与默认圆角，尺寸完全由 className 决定 */
  card?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children, className = "", type = "button", variant, disabled, card: cardProp, ...props
}, ref) {
  const intent = variant ?? (/(^|\s)(bg-primary|brand-grad)(\s|$)/.test(className) ? "primary" : "ghost");
  const card = cardProp === true || (props.style?.paddingTop !== undefined || props.style?.aspectRatio !== undefined) || /(?:ios-poster|hg-poster|ios-row-card|ios-rank-row|ios-account-card|ios-collection-link|ios-topic-card|hg-topic-card-v2|hg-hero|hg-spotlight|hg-pill|hg-rail-card|hg-icon-plain|hg-continue|hg-section-more|hg-searchbar|hg-filter-text|hg-tab|hg-ed-tab|hg-bento-tile|hg-inline-sort|hg-top10-card|hg-wide-card|hg-topic-mini|hg-premiere-card|hg-podium-card|hg-rank-row-v2|hg-hist-card|hg-sub-btn|hg-tag-pill|hg-quick-action|hg-detail-fav|hg-tag-chip|hg-ep-cell|hg-loadmore)/.test(className);
  return <button {...props} ref={ref} type={type} disabled={disabled}
    data-ui="button" data-variant={intent} data-card={card || undefined}
    className={cn("ios-button", `ios-button-${intent}`, className)}>
    {children}
  </button>;
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, onFocus, ...props }, ref) {
  /* 移动端键盘会盖住输入框：聚焦后等键盘弹出（≈250ms）再把输入框滚到屏幕中间。
     behavior 用 smooth，reduced-motion 下浏览器会自己退化成直接跳。 */
  const focusIntoView = (event: ReactFocusEvent<HTMLInputElement>) => {
    onFocus?.(event);
    const el = event.currentTarget;
    if (!el || el.type === "range") return;
    window.setTimeout(() => {
      try { el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" }); } catch { /* 老内核忽略 */ }
    }, 250);
  };
  return <input {...props} onFocus={focusIntoView} ref={ref} aria-label={props["aria-label"] ?? props.placeholder}
    data-ui={props.type === "range" ? "range" : "input"}
    className={cn(props.type === "range" ? "ios-range" : "ios-input", className)} />;
});
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...props }, ref) {
  return <textarea {...props} ref={ref} aria-label={props["aria-label"] ?? props.placeholder} data-ui="textarea" className={cn("ios-input ios-textarea", className)} />;
});
export const Surface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Surface({ children, className, ...props }, ref) {
  return <div {...props} ref={ref} className={cn("ios-surface", className)} data-ui="surface">
    {children}
  </div>;
});
type SegmentedStyle = CSSProperties & { "--segment-count": number; "--segment-index": number };
export function SegmentedControl({ children, className, style, activeIndex, ...props }: HTMLAttributes<HTMLDivElement> & { activeIndex: number }) {
  const segments = Children.toArray(children);
  const count = Math.max(segments.length, 1);
  const index = Math.max(0, Math.min(activeIndex, count - 1));
  /* The selected index lives here so segment count and indicator travel cannot drift apart. */
  /* Keep rendered segment children untouched for focus and accessibility order. */
  const segmentStyle = { ...style, "--segment-count": count, "--segment-index": index } as SegmentedStyle;
  return <div {...props} style={segmentStyle} className={cn("ios-segmented", className)} role={props.role ?? "group"} aria-label={props["aria-label"] ?? "切换内容"}>
    <span className="ios-segmented-indicator" aria-hidden="true" />
    <span className="ios-segmented-items">{segments}</span>
  </div>;
}

export const Form = forwardRef<HTMLFormElement, FormHTMLAttributes<HTMLFormElement>>(function Form({ children, className, ...props }, ref) {
  return <form {...props} ref={ref} className={cn("ios-form", className)}>
    {children}
  </form>;
});

export const Image = forwardRef<HTMLImageElement, ImgHTMLAttributes<HTMLImageElement>>(function Image({ alt = "", decoding = "async", loading = "lazy", ...props }, ref) {
  return <img {...props} ref={ref} alt={alt} decoding={decoding} loading={loading} fetchPriority={loading === "eager" ? "high" : "auto"} data-ui="image" />;
});
