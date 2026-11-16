import { useEffect, useState } from "react";
import Search from "./Search";
import Category from "./Category";
import { Button } from "../components/ios/controls";
import { CollectionLink, CollectionLinks } from "../components/CollectionLink";
import { api, cover } from "../api";
import type { VideoCard } from "../types";
import { useStore } from "../store";
import { ambientStyle, useAccent, useAmbient } from "../useAccent";
import { IComment, IGlobe, IGrid, ITrophy } from "../icons";

const CHIPS = ["全部", "都市", "古装", "玄幻", "悬疑"];

/** 剧场把搜索、分类和热播收在同一页，原来的搜索页和分类页都还在。 */
export default function Theater({ active, wide }: { active: boolean; wide: boolean }) {
  const [channels, setChannels] = useState(false);
  const ambient = useAmbient();
  return (
    <div className="absolute inset-0" style={ambientStyle(ambient)}>
      <div className={channels ? "hidden" : "absolute inset-0"}>
        <Search active={active && !channels} wide={wide} title="剧场" extra={<Showcase active={active && !channels} onChannels={() => setChannels(true)} />} />
      </div>
      {channels && (
        <div className="absolute inset-0 z-10">
          <Category wide={wide} active={active} />
          <Button aria-label="返回剧场" onClick={() => setChannels(false)}
            className="absolute right-3 z-20 min-h-11 px-3 text-primary"
            style={{ top: "max(12px, env(safe-area-inset-top))" }}>返回剧场</Button>
        </div>
      )}
    </div>
  );
}

function Showcase({ active, onChannels }: { active: boolean; onChannels: () => void }) {
  const { push } = useStore();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [chip, setChip] = useState("全部");
  useEffect(() => {
    if (!active) return;
    let cancel = false;
    api.category("ai-duanju", 1, 8, "latest").then(res => { if (!cancel) setItems(res?.items || []); }).catch(() => {});
    return () => { cancel = true; };
  }, [active]);
  const slides = items.slice(0, 3);
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setSlide(index => (index + 1) % slides.length), 4000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  return (
    <div className="mb-4">
      <div className="v3-bento" aria-label="发现入口">
        <button type="button" aria-label="打开热播榜" onClick={() => push({ kind: "ranks" })}><ITrophy size={18} /><b>打开热播榜</b><span>热度、推荐、潜力</span></button>
        <button type="button" aria-label="打开分类" onClick={onChannels}><IGrid size={18} /><b>打开分类</b><span>频道和排序</span></button>
        <button type="button" aria-label="吃瓜" onClick={() => push({ kind: "posts" })}><IComment size={18} /><b>吃瓜</b><span>帖子和讨论</span></button>
      </div>
      {!!slides.length && (
        <div className="db-carousel">
          {slides.map((item, index) => (
            <button key={item.id} type="button" style={{ transform: `translateX(${(index - slide) * 100}%)` }}
              onClick={() => push({ kind: "series", videoId: item.id, title: item.title })}>
              <img src={cover(item.cover)} alt="" />
              <div>
                <strong>{item.title}</strong>
                <em>独家首播</em>
              </div>
            </button>
          ))}
          <div className="db-dots">{slides.map((item, index) => <i key={item.id} className={index === slide ? "is-on" : ""} />)}</div>
        </div>
      )}
      <div className="db-chips" role="tablist" aria-label="题材">
        {CHIPS.map(name => (
          <button key={name} type="button" className={chip === name ? "is-on" : ""} aria-pressed={chip === name}
            onClick={() => { setChip(name); if (name !== "全部") push({ kind: "tag", tag: name, name }); }}>{name}</button>
        ))}
      </div>
      <div className="db-block">
        <b>热播榜</b>
        <button type="button" onClick={onChannels}>全部分类 ›</button>
      </div>
      <div className="db-rank">
        {items.slice(0, 3).map((item, index) => <RankCard key={item.id} item={item} index={index} onOpen={() => push({ kind: "series", videoId: item.id, title: item.title })} />)}
      </div>
      <CollectionLinks className="ios-category-links mt-4 mb-2">
        <CollectionLink aria-label="专题" icon={<IGrid size={18} />} title="专题" subtitle="精选专辑合集" onClick={() => push({ kind: "topics" })} />
        <CollectionLink aria-label="标签" icon={<IGlobe size={18} />} title="标签" subtitle="按题材找片" onClick={() => push({ kind: "tags" })} />
      </CollectionLinks>
    </div>
  );
}

function RankCard({ item, index, onOpen }: { item: VideoCard; index: number; onOpen: () => void }) {
  const scheme = useAccent(item.id, cover(item.cover));
  return (
    <button type="button" onClick={onOpen} aria-label={`热播 ${item.title}`}>
      <img src={cover(item.cover)} alt="" style={{ borderColor: scheme.accent, boxShadow: `0 0 12px ${scheme.accent}55` }} />
      <i style={{ background: scheme.accent, color: "#0e0f13" }}>{index + 1}</i>
      <small>{item.title}</small>
    </button>
  );
}
