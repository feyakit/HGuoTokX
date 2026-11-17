import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Button } from "../components/ios/controls";
import { Empty, Img } from "../components/ui";
import { IBack, IGlobe } from "../icons";
import type { Post, PostCategory } from "../types";

/** 服务端时间是 "YYYY-MM-DD HH:mm:ss"。 */
function dayOf(raw?: string): string {
  const text = (raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}
function clockOf(raw?: string): string {
  const text = (raw || "").trim();
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text) ? text.slice(11, 16) : "";
}
function shifted(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Group = { key: string; label: string; items: Post[] };

/**
 * 吃瓜二级页：按日期分组的消息流。
 * 左列只给 HH:mm，中间一条竖线串起当天条目（当天首条实心 accent，其余灰点），
 * 右边是标题 + 来源/时间，封面固定 88×66 缩略图（不做 16:9 大图）。
 */
export default function GossipPage({ onBack }: { onBack: () => void }) {
  const { push } = useStore();
  const [groups, setGroups] = useState<PostCategory[]>([]);
  const [seg, setSeg] = useState("all");
  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.postCategories()
      .then(res => {
        if (cancelled) return;
        setGroups((res?.items ?? []).filter(item => item && typeof item.route === "string" && !!item.name));
      })
      .catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const request = seg === "all" ? api.posts(1, 40) : api.postCategory(seg, 1, 40);
    request
      .then(res => { if (!cancelled) setItems((res?.items ?? []).filter(Boolean)); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setItems([]);
        setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [seg, reload]);

  const segments = useMemo(
    () => [{ route: "all", name: "全部" }, ...groups.map(g => ({ route: g.route, name: g.name }))],
    [groups],
  );

  /* 真按日期分组：今天 / 昨天 / 更早；组内保持服务端顺序（新→旧） */
  const timeline = useMemo(() => {
    const today = shifted(0);
    const yesterday = shifted(1);
    const map = new Map<string, Group>();
    for (const post of items) {
      const key = dayOf(post.created_at) || dayOf(post.publish_time);
      const label = key === today ? "今天" : key === yesterday ? "昨天" : "更早";
      const bucket = map.get(key) ?? { key, label, items: [] };
      bucket.items.push(post);
      map.set(key, bucket);
    }
    return [...map.values()];
  }, [items]);

  return (
    <div className="ios-page ios-tint-08 absolute inset-0 bg-bg flex flex-col">
      <div className="ios-page-heading shrink-0 px-4 flex items-center gap-2">
        <Button onClick={onBack} aria-label="返回" className="ios-icon-button"><IBack size={17} /></Button>
        <h1 className="ios-page-title text-on">吃瓜</h1>
      </div>

      <div className="shrink-0 px-4 pb-2 flex items-center gap-5">
        {segments.map(item => (
          <button key={item.route} type="button" onClick={() => setSeg(item.route)}
            className={`hg-gossip-seg${seg === item.route ? " is-on" : ""}`}>{item.name}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 scroll-y px-4 pb-10">
        {loading && [0, 1, 2].map(index => (
          <div key={index} className="hg-gossip-row" aria-hidden="true">
            <span className="hg-gossip-time"><span className="shimmer block h-[10px] w-[30px] rounded-full" /></span>
            <span className="hg-gossip-line"><i /></span>
            <span className="hg-gossip-body">
              <span className="shimmer block h-[13px] w-4/5 rounded-full" />
              <span className="shimmer mt-2 block h-[11px] w-1/2 rounded-full" />
            </span>
            <span className="shimmer h-[66px] w-[88px] shrink-0 rounded-[10px]" />
          </div>
        ))}

        {!loading && error && (
          <Empty icon={<IGlobe size={24} />} title="暂时加载不出来" sub={error} action="重试" onAction={() => setReload(v => v + 1)} />
        )}

        {!loading && !error && !items.length && (
          <Empty icon={<IGlobe size={24} />} title="这个分段还没有内容" sub="换个分段看看" />
        )}

        {!loading && !error && timeline.map(group => (
          <section key={group.key || group.label}>
            <h2 className="hg-gossip-day"><span>{group.label}</span><i /></h2>
            {group.items.map((post, index) => (
              <button key={post.id} type="button" className="hg-gossip-row text-left"
                onClick={() => push({ kind: "post", id: post.id })}>
                <span className="hg-gossip-time">{clockOf(post.created_at) || clockOf(post.publish_time)}</span>
                <span className="hg-gossip-line">{index === 0 ? <i className="is-first" /> : <i />}</span>
                <span className="hg-gossip-body">
                  <span className="hg-gossip-title">{post.title}</span>
                  <span className="hg-gossip-meta">{post.author?.name || "爆料"} · {group.label}</span>
                </span>
                <span className="hg-gossip-thumb"><Img src={post.cover} alt="" /></span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
