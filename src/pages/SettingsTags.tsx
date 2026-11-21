import { Button } from "../components/ios/controls";
import { useContentPreferences } from "../contentPreferences";
import { ContentPreferenceTags } from "../components/ContentPreferencesSettings";
import { IBack } from "../icons";

/* 「屏蔽标签」二级页：设置「内容偏好」组那一行，以及发现页「管理屏蔽标签」都进这里。
 *
 * 以前它是设置组里内联展开的一整块：标签一多就把设置页撑成三屏，而且
 * 每次改设置都要先展开。头栏沿用观看历史 / 我的收藏 同一套 .hg-subpage-bar。 */
export default function SettingsTags({ onBack }: { onBack: () => void }) {
  const { preferences } = useContentPreferences();
  /* 数量与状态由下方状态块说明，这里只讲作用范围，避免同一个数字说两遍 */
  const meta = preferences.paused ? "已暂停，规则仍保留" : "只影响本机展示";
  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <header className="shrink-0 hg-subpage-bar relative z-10">
        <Button card className="hg-sub-btn" aria-label="返回" onClick={onBack}>
          <IBack size={19} />
        </Button>
        <div className="hg-sub-titles">
          <h1 className="hg-sub-title">屏蔽标签</h1>
          <div className="hg-sub-meta">{meta}</div>
        </div>
      </header>
      <div className="flex-1 scroll-y hg-page-x pt-3 relative z-10" style={{ paddingBottom: "calc(32px + var(--sab, 0px))" }}>
        <ContentPreferenceTags />
      </div>
    </div>
  );
}
