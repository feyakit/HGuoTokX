import { normalizeTag } from "../model/contentPreferences";
import { IChevR } from "./icons";
import { Button } from "./ios/controls";
import { useLongPress } from "../lib/useLongPress";
import "../../styles/video-details.css";

/**
 * 标签芯片：点按看同类，长按屏蔽该标签（上游 #170 的判定，UI 不动）。
 * 长按判定走共享的 useLongPress：550ms，手指位移超过 10px 就取消 —— 竖向滚动和横向滑动
 * 都不会被误判成长按。
 */
function TagChip({ tag, onOpen, onBlock }: { tag: string; onOpen: () => void; onBlock?: () => void }) {
  const { longPressProps, consumeSuppressedClick } = useLongPress(onBlock);
  const press = () => {
    if (consumeSuppressedClick()) return;
    onOpen();
  };
  return <Button aria-label={onBlock ? `查看标签 ${tag}，长按屏蔽` : `查看标签 ${tag}`} onClick={press}
    className="content-tag-link" {...longPressProps}>
    <span className="content-tag-hash" aria-hidden="true">#</span>
    <span className="content-tag-name">{tag}</span>
    <IChevR size={13} aria-hidden="true" />
  </Button>;
}

/** Tag labels are routes, not decorative badges. Preserve the provider's display spelling. */
export function ContentTags({ tags, onOpen, onBlock, label = "视频标签" }: {
  tags: readonly string[]; onOpen: (tag: string) => void; onBlock?: (tag: string) => void; label?: string;
}) {
  const names = tags.map(tag => typeof tag === "string" ? tag.trim().replace(/\s+/g, " ") : "");
  const unique = names.filter((tag, index) => tag && names.findIndex(name => normalizeTag(name) === normalizeTag(tag)) === index);
  if (!unique.length) return <p className="video-detail-empty-tags">暂未提供标签</p>;
  return <div className="content-tags" role="group" aria-label={label}>
    {unique.map(tag => <TagChip key={normalizeTag(tag)} tag={tag} onOpen={() => onOpen(tag)}
      onBlock={onBlock ? () => onBlock(tag) : undefined} />)}
  </div>;
}
