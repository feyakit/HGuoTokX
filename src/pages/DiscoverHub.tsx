import { useEffect, useState } from "react";
import Search from "./Search";
import { Button, SegmentedControl } from "../components/ios/controls";
import { api, cover } from "../api";
import type { Post, RankItem, VideoCard } from "../types";
import { useStore } from "../store";
import { openTitles } from "../openVideo";
import { RankRow } from "../components/cards";
import { ISearch } from "../icons";
import { useAccent } from "../useAccent";

const CHIPS = ["全部", "都市", "古装", "玄幻", "悬疑"];
const RANKS = [
  { key: "hot" as const, label: "热播榜" },
  { key: "recommend" as const, label: "推荐榜" },
  { key: "potential" as const, label: "潜力榜" },
];

/** 发现把搜索、榜单、题材、专题、标签和吃瓜收成一页，每个只留一个入口。 */
export default function DiscoverHub({ active, wide }: { active: boolean; wide: boolean }) {
  const [searching, setSearching] = useState(false);
  const [seg, setSeg] = useState<"video" | "post">("video");
  return (
    <div className="ios-page v3-discover absolute inset-0 flex flex-col">
      <div className={searching ? "hidden" : "absolute inset-0 flex flex-col"}>
        <div className="ios-page-heading shrink-0 px-4"><h1 className="ios-page-title">发现</h1></div>
        <div className="shrink-0 px-4">
          <button type="button" className="v3-search" aria-label="搜索短剧、帖子、题材…" onClick={() => setSearching(true)}>
            <ISearch size={18} /><span>搜索短剧、帖子、题材…</span>
          </button>
          <SegmentedControl className="mt-3" aria-label="发现内容" activeIndex={seg === "video" ? 0 : 1}>
            <Button aria-pressed={seg === "video"} onClick={() => setSeg("video")}>剧集</Button>
            <Button aria-pressed={seg === "post"} onClick={() => setSeg("post")}>吃瓜</Button>
          </SegmentedControl>
        </div>
        <div className="flex-1 scroll-y px-4 pt-4" style={{ paddingBottom: "calc(128px + var(--sab, 16px))" }}>
          {seg === "video" ? <VideoPane active={active && !searching} wide={wide} /> : <PostPane active={active && !searching} />}
        </div>
      </div>
      {searching && (
        <div className="absolute inset-0 z-20">
          <Search active={active} wide={wide} title="搜索" showRank={false} onBack={() => setSearching(false)} />
        </div>
      )}
    </div>
  );
}

function VideoPane({ active, wide }: { active: boolean; wide: boolean }) {
  const { push } = useStore();
  const [items, setItems] = useState<VideoCard[]>([]);
  const [chip, setChip] = useState("全部");
  const [rankKey, setRankKey] = useState<(typeof RANKS)[number]["key"]>("hot");
  const [ranks, setRanks] = useState<RankItem[]>([]);
  const [topics, setTopics] = useState<{ slug: string; title: string; cover: string }[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    if (!active) return;
    let cancel = false;
    api.category("ai-duanju", 1, 12, "latest").then(res => { if (!cancel) setItems(res?.items || []); }).catch(() => {});
    api.topics().then(res => { if (!cancel) setTopics((res?.items || []).slice(0, 8).map(item => ({ slug: item.slug, title: item.title, cover: item.cover }))); }).catch(() => {});
    api.tags().then(res => {
      if (cancel) return;
      const names = (res?.categories || []).flatMap(group => group.tags.map(tag => tag.name));
      setTags([...new Set(names)].slice(0, 12));
    }).catch(() => {});
    return () => { cancel = true; };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let cancel = false;
    api.rank(rankKey).then(res => { if (!cancel) setRanks(res?.items || []); }).catch(() => { if (!cancel) setRanks([]); });
    return () => { cancel = true; };
  }, [active, rankKey]);
  const shown = chip === "全部" ? items : items.filter(item => item.tags?.includes(chip));
  const max = Math.max(1, ...ranks.map(item => item.metric_value || 0));
  return (
    <div>
      <div className="v3-chips" role="tablist" aria-label="题材">
        {CHIPS.map(name => (
          <button key={name} type="button" className={chip === name ? "is-on" : ""} aria-pressed={chip === name} onClick={() => setChip(name)}>{name}</button>
        ))}
      </div>
      <div className="v3-block"><h2>榜单</h2></div>
      <SegmentedControl aria-label="榜单类型" activeIndex={RANKS.findIndex(item => item.key === rankKey)}>
        {RANKS.map(item => (
          <Button key={item.key} aria-pressed={rankKey === item.key} onClick={() => setRankKey(item.key)}>{item.label}</Button>
        ))}
      </SegmentedControl>
      <div className="mt-3">
        {ranks.slice(0, 8).map(item => (
          <RankRow key={`${rankKey}-${item.video_id}`} item={item} metricMax={max}
            onOpen={() => openTitles(push, ranks.map(row => row.video_id), ranks.findIndex(row => row.video_id === item.video_id), item.title)} />
        ))}
      </div>
      <div className="v3-block">
        <h2>专辑</h2>
        <Button onClick={() => push({ kind: "topics" })}><span>专题</span></Button>
      </div>
      <div className="v3-hscroll">
        {topics.map(topic => (
          <button key={topic.slug} type="button" className="v3-topic" onClick={() => push({ kind: "topic", slug: topic.slug, name: topic.title })}>
            <img src={cover(topic.cover)} alt="" />
            <b>{topic.title}</b>
          </button>
        ))}
      </div>
      <div className="v3-block"><h2>按标签找片</h2></div>
      <div className="v3-chips">
        {tags.map(name => (
          <button key={name} type="button" onClick={() => push({ kind: "tag", tag: name, name })}>{name}</button>
        ))}
      </div>
      <div className="v3-block"><h2>信息流</h2></div>
      <div className={`v3-grid ${wide ? "is-wide" : ""}`}>
        {shown.map(item => <FeedCard key={item.id} item={item} onOpen={() => openTitles(push, shown.map(row => row.id), shown.findIndex(row => row.id === item.id), item.title)} />)}
      </div>
    </div>
  );
}

function FeedCard({ item, onOpen }: { item: VideoCard; onOpen: () => void }) {
  const scheme = useAccent(item.id, cover(item.cover));
  return (
    <button type="button" className="v3-card" onClick={onOpen}>
      <img src={cover(item.cover)} alt="" style={{ boxShadow: `inset 0 0 0 1px ${scheme.accent}` }} />
      <b>{item.title}</b>
    </button>
  );
}

function PostPane({ active }: { active: boolean }) {
  const { push } = useStore();
  const [posts, setPosts] = useState<Post[]>([]);
  useEffect(() => {
    if (!active) return;
    let cancel = false;
    api.posts(1, 20).then(res => { if (!cancel) setPosts(res?.items || []); }).catch(() => {});
    return () => { cancel = true; };
  }, [active]);
  return (
    <div className="v3-posts">
      {posts.map(post => (
        <button key={post.id} type="button" onClick={() => push({ kind: "post", id: post.id })}>
          <b>{post.title}</b>
          <span>{post.tags?.slice(0, 2).join(" · ")}</span>
        </button>
      ))}
      {!posts.length && <p className="v3-empty">暂时没有帖子</p>}
    </div>
  );
}
