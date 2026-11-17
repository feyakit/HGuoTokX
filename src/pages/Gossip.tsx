import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Button } from "../components/ios/controls";
import { IBack } from "../icons";
import type { PostCategory } from "../types";

/**
 * 吃瓜二级页：从首页右上角入口进来。
 *
 * 这一批先落「壳」——标题、返回、子分段（全部 / 各板块），数据源已经换成
 * `/api/site/categories/post`，失败回落「全部」。时间线列表在下一批接入。
 */
export default function GossipPage({ onBack }: { onBack: () => void }) {
  const { push } = useStore();
  const [groups, setGroups] = useState<PostCategory[]>([]);
  const [active, setActive] = useState("all");

  useEffect(() => {
    let cancelled = false;
    api.postCategories()
      .then(res => {
        if (cancelled) return;
        const items = (res?.items ?? []).filter(item => item && typeof item.route === "string" && item.name);
        setGroups(items);
      })
      .catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, []);

  /* 「全部」在前，后面跟服务端下发的板块 */
  const segments = useMemo(() => [{ route: "all", name: "全部" }, ...groups.map(g => ({ route: g.route, name: g.name }))], [groups]);

  return (
    <div className="ios-page ios-tint-12 absolute inset-0 bg-bg flex flex-col">
      <div className="ios-page-heading shrink-0 px-4 flex items-center gap-2">
        <Button onClick={onBack} aria-label="返回" className="ios-icon-button"><IBack size={17} /></Button>
        <h1 className="ios-page-title text-on">吃瓜</h1>
      </div>

      <div className="shrink-0 px-4 pb-2 flex items-center gap-5">
        {segments.map(item => (
          <button key={item.route} type="button" onClick={() => setActive(item.route)}
            className={`hg-gossip-seg${active === item.route ? " is-on" : ""}`}>{item.name}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 scroll-y px-4 pb-24">
        {[0, 1, 2].map(index => (
          <div key={index} className="hg-gossip-row" aria-hidden="true">
            <span className="hg-gossip-time"><span className="shimmer h-[10px] w-[34px] rounded-full" /></span>
            <span className="hg-gossip-line"><i /></span>
            <span className="hg-gossip-body">
              <span className="shimmer block h-[13px] w-4/5 rounded-full" />
              <span className="shimmer mt-2 block h-[11px] w-1/2 rounded-full" />
            </span>
            <span className="shimmer h-[66px] w-[88px] shrink-0 rounded-[12px]" />
          </div>
        ))}
        <p className="mt-6 text-center text-[12px] text-dim">时间线列表下一批接入</p>
        <div className="mt-3 flex justify-center">
          <Button className="px-4 text-primary" onClick={() => push({ kind: "settings", section: "内容偏好" })}>调整内容偏好</Button>
        </div>
      </div>
    </div>
  );
}
