import type { ReactNode } from "react";
import { Button } from "./ios/controls";
import { Toggle } from "./ui";
import { IChevR } from "../icons";

/** 设置分组：组标题在卡外，同组的行合成一张卡。
 *
 *  这里原来是可折叠的 SettingsSection：进设置页看到六张一模一样的
 *  「标题 + 摘要 + 徽标 + 箭头」，点开才知道里面有什么，而且摘要和徽标
 *  经常跟行内的值说同一句话。平铺后一次都不用点。
 */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="hg-set-group">
      <h2 className="hg-set-group-title">{title}</h2>
      <div className="hg-set-card">{children}</div>
    </section>
  );
}

/** 右侧只有三种形态：开/关、有当前值、纯进入。第四种（把值塞进胶囊）不再存在。 */
export type SettingsRowRight =
  | { kind: "switch"; on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }
  | { kind: "value"; value?: string }
  | { kind: "nav" };

type SettingsRowProps = {
  icon?: ReactNode;
  title: ReactNode;
  /** 写「会发生什么」，不写「当前是什么」——当前值已经在右边了 */
  sub?: ReactNode;
  right: SettingsRowRight;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export function SettingsRow({ icon, title, sub, right, danger, disabled, onClick }: SettingsRowProps) {
  const copy = (
    <>
      {icon ? <span className="hg-set-row-icon">{icon}</span> : null}
      <span className="hg-set-row-copy">
        <span className="hg-set-row-title">{title}</span>
        {sub ? <span className="hg-set-row-sub">{sub}</span> : null}
      </span>
    </>
  );

  if (right.kind === "switch") {
    return (
      <div className="hg-set-row">
        {copy}
        <Toggle desktop on={right.on} onChange={right.onChange} disabled={right.disabled} label={right.label} />
      </div>
    );
  }

  return (
    <Button className={`hg-set-row${danger ? " is-danger" : ""}`} disabled={disabled} onClick={onClick}>
      {copy}
      {right.kind === "value" && right.value ? <span className="hg-set-row-value">{right.value}</span> : null}
      <span className="hg-set-row-chev" aria-hidden="true"><IChevR size={14} /></span>
    </Button>
  );
}
