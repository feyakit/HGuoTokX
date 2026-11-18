import { Button, Surface } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, cover, fmt, isMobile } from "../api";
import type { Post } from "../types";
import { useStore } from "../store";
import { copyText } from "../clipboard";
import { Empty, Img } from "../components/ui";
import Player from "../components/Player";
import { IBack, IComment, IFireF, IHeart, IPlayF, ISearch, IStar } from "../icons";
import { handleArticleClick, sanitizeHtml } from "../html";
import { InplaceSearch } from "../components/InplaceSearch";
import { FilteredContent } from "../components/FilteredContent";
import { TagBlockMenu } from "../components/TagBlockMenu";
import { useContentPreferences } from "../contentPreferences";
import { postHot } from "../postData";

/* ================= 吃瓜列表 ================= */
/** 列表接口（/api/posts）只给标题/封面/热度；作者与点赞/评论数只在详情接口里。
 *  卡片要画头像/昵称/互动数，就按 id 补一次详情；结果进模块级缓存，切 tab 回来不再重复请求。 */
type PostExtra = { author?: Post["author"]; like?: number; comment?: number; collect?: number; hot?: number };
const postExtra = new Map<number, PostExtra>();
const extraOf = (p: Post): PostExtra | undefined => postExtra.get(p.id);

const SORTS = [
  { key: "latest", label: "Latest" },
  { key: "trending", label: "Trending" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const postTime = (p: Post) => {
  const raw = (p.publish_time || p.created_at || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? `Posted on ${MONTHS[Math.max(0, +m[2] - 1)] || m[2]} ${+m[3]}` : raw;
};

export function PostsPage({ onBack, wide, embedded = false }: { onBack?: () => void; wide: boolean; embedded?: boolean }) {
  const { push, toast } = useStore();
  const { preferences } = useContentPreferences();
  const filtering = !preferences.paused && (preferences.blockedTags.length > 0 || preferences.hideUntagged);
  const [sort, setSort] = useState<SortKey>("latest");
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<Post[]>([]);
  const [extra, setExtra] = useState<Record<number, PostExtra>>({});
  const [followed, setFollowed] = useState<Record<number, boolean>>({});
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMore = async (reset = false) => {
    if (busy.current) return;
    const next = reset ? 1 : page + 1;
    if (!reset && next > pages) return;
    busy.current = true;
    setLoading(true);
    setErr("");
    try {
      const res = await api.posts(next, 20, sort);
      setItems((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((x) => x.id));
        return [...base, ...(res?.items || []).filter((x) => !seen.has(x.id))];
      });
      setPage(next);
      setPages(res?.pagination?.pages || next);
      setErr("");
    } catch (e) {
      setErr((e as Error).message || "吃瓜内容加载失败");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  /* 换 tab：清空列表重新拉（两路排序是不同结果集，不能拼在一起） */
  useEffect(() => {
    setItems([]);
    setPage(0);
    setPages(1);
    scrollRef.current?.scrollTo(0, 0);
    void loadMore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  /* 补详情：3 路并发，顺序按列表顺序；失败就只显示列表字段，不阻塞也不重试打扰 */
  useEffect(() => {
    const missing = items.map((x) => x.id).filter((id) => !postExtra.has(id));
    if (!missing.length) return;
    let alive = true;
    const queue = missing.slice();
    const worker = async () => {
      while (alive) {
        const id = queue.shift();
        if (id == null) return;
        try {
          const detail = await api.post(id);
          if (!alive) return;
          const got: PostExtra = {
            author: detail.author,
            like: detail.counts?.like,
            comment: detail.counts?.comment,
            collect: detail.counts?.collect,
            hot: postHot(detail),
          };
          postExtra.set(id, got);
          setExtra((prev) => ({ ...prev, [id]: got }));
        } catch { /* 详情拿不到：卡片退回列表字段 */ }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => { alive = false; };
  }, [items]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || err || filtering) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { root: scrollRef.current, rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages, err, filtering]);

  const card = (p: Post) => {
    const info = extra[p.id] ?? extraOf(p);
    const pic = info?.author?.avatar;
    const initial = (info?.author?.name || "").trim().charAt(0);
    const isFollowed = !!followed[p.id];
    return (
      <div key={p.id} className="hg-post-card" onClick={() => push({ kind: "post", id: p.id })}>
        <div className="hg-post-head">
          <span className="hg-post-avatar" aria-hidden="true">
            {pic ? <Img src={pic} /> : (initial || "U")}
          </span>
          <span className="hg-post-who">
            <span className="hg-post-name">{info?.author?.name || "Username"}</span>
            <span className="hg-post-time">{postTime(p)}</span>
          </span>
          <button type="button" className={`hg-follow-btn${isFollowed ? " is-on" : ""}`}
            onClick={(e) => { e.stopPropagation(); setFollowed(prev => ({ ...prev, [p.id]: !prev[p.id] })); }}>
            {isFollowed ? "Following" : "Follow"}
          </button>
        </div>
        <div className="hg-post-title">{p.title}</div>
        <div className="hg-post-grid2x2">
          {[0, 1, 2, 3].map(idx => (
            <span key={idx} className="hg-post-grid-cell">
              <Img src={p.cover} alt="" />
            </span>
          ))}
        </div>
        <div className="hg-post-stats">
          <span className="hg-post-stat"><span className="hg-post-heart">♥</span>{fmt(info?.like ?? 0)}</span>
          <span className="hg-post-stat"><IComment size={16} />{fmt(info?.comment ?? 0)}</span>
          <span className="hg-post-stat"><span aria-hidden="true">↗</span>{fmt(info?.hot ?? p.hot)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <div className="shrink-0 hg-page-x flex items-center gap-3 relative z-10"
        style={{ paddingTop: "calc(var(--sat, 0px) + 8px)", paddingBottom: 8 }}>
        {!embedded && onBack && (
          <Button aria-label="返回" onClick={onBack} className="ios-icon-button shrink-0"><IBack size={19} /></Button>
        )}
        <div className="hg-tabs" role="tablist" aria-label="社区分栏">
          {SORTS.map((s) => (
            <Button key={s.key} role="tab" aria-selected={sort === s.key} className={`hg-tab hg-tab-ul${sort === s.key ? " is-on" : ""}`}
              onClick={() => setSort(s.key)}>{s.label}</Button>
          ))}
        </div>
        <span className="flex-1" />
        <Button card className="hg-post-cta" onClick={() => toast("发帖功能暂未开放", "info")}>Post</Button>
      </div>

      <div ref={scrollRef} aria-busy={loading} className="flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: "calc(110px + var(--sab, 0px))" }}>
        {items.length ? (
          <FilteredContent items={items} scopeKey={`posts-${sort}`}>{visible => (
            <div className="hg-post-feed">
              {visible.map(card)}
            </div>
          )}</FilteredContent>
        ) : loading ? (
          <div className="flex justify-center py-12"><Loader className="w-8 h-8 spinner" /></div>
        ) : err ? (
          <Empty icon={<IFireF size={26} />} title="吃瓜内容加载失败" sub={err} action="重试" onAction={() => loadMore(true)} />
        ) : (
          <Empty icon={<IFireF size={26} />} title="暂无吃瓜内容" sub="稍后再来看看" />
        )}
        <div ref={sentinel} className="h-10" />
        {err && items.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3 py-2 text-[13px] text-danger" role="alert">
            <span>加载更多失败：{err}</span>
            <Button disabled={loading} onClick={() => loadMore()} className="text-primary pressable">重试</Button>
          </div>
        )}
        {!loading && !err && items.length > 0 && page < pages && <Button onClick={() => loadMore()} className="w-full mt-3">加载更多</Button>}
        {loading && items.length > 0 && <div className="flex justify-center py-2"><Loader className="w-6 h-6 spinner" /></div>}
      </div>
      {searching && <InplaceSearch kind="post" postLabel="吃瓜帖子" wide={wide} onClose={() => setSearching(false)} onOpenPost={(p) => push({ kind: "post", id: p.id })} />}
    </div>
  );
}

const isHtml = (s: string) => /<(p|div|br|img|h[1-6]|ul|ol|li|blockquote|span|strong|em)\b/i.test(s);
/* 过滤上游旧品牌标签，避免显示到界面。 */
const HIDDEN_POST_TAG = "\u9ec4\u679c";

/* ================= 吃瓜详情（网页式浏览） ================= */
export function PostDetail({ id, onBack, active = true }: { id: number; onBack: () => void; active?: boolean }) {
  const { toast, strictSecurity, muted, setMuted, push } = useStore();
  const { preferences, blockReason } = useContentPreferences();
  const filtering = !preferences.paused && (preferences.blockedTags.length > 0 || preferences.hideUntagged);
  const [post, setPost] = useState<(Post & { content?: string; video_url?: string }) | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const autoBackKey = useRef("");
  const [tagMenu, setTagMenu] = useState(false);
  useEffect(() => { if (!active) setTagMenu(false); }, [active]);
  const currentPost = loadedId === id ? post : null;
  const blocked = filtering && currentPost ? blockReason(currentPost.tags) : null;
  const allowed = !filtering || (!!currentPost && !blocked);
  useEffect(() => {
    if (!active || !filtering || !currentPost || !blocked) {
      if (!blocked) autoBackKey.current = "";
      return;
    }
    const key = String(id);
    if (autoBackKey.current === key) return;
    autoBackKey.current = key;
    onBack();
  }, [active, filtering, currentPost, blocked, id, onBack]);
  useEffect(() => { if (!allowed) setTagMenu(false); }, [allowed]);
  const [err, setErr] = useState<string | null>(null);
  const [play, setPlay] = useState(false);
  /* 吃瓜帖详情里的 video_url 恒为空，视频地址只在 playback 接口里；
     不解析就整页只有图文（issue #11）。segs 是分段地址，多数帖只有 1 段。 */
  const [segs, setSegs] = useState<string[]>([]);
  const [seg, setSeg] = useState(0);
  const [resolving, setResolving] = useState(false);
  const [reload, setReload] = useState(0);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [mediaError, setMediaError] = useState("");
  const [readProgress, setReadProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const content = post?.content || "";
  const src = segs[seg] || "";
  const safeHtml = useMemo(() => sanitizeHtml(content), [content, strictSecurity]);
  const openSafeLink = (url: string) => {
    api.openUrl(url).catch(() => {
      copyText(url).then(() => toast("链接已复制", "ok")).catch(() => toast("复制失败", "info"));
    });
  };

  useEffect(() => {
    let alive = true;
    setReadProgress(0);
    scrollRef.current?.scrollTo(0, 0);
    setPost(null);
    setLoadedId(null);
    setTagMenu(false);
    setErr(null);
    setPlay(false);
    setSegs([]);
    setSeg(0);
    api.post(id)
      .then((p) => {
        if (!alive) return;
        setPost(p);
        setLoadedId(id);
        /* 旧接口返回直链时提供回退，不覆盖已经解析出的分段。 */
        if (p.video_url) { setSegs(previous => previous.length ? previous : [p.video_url!]); setPlay(true); }
      })
      .catch((e) => { if (alive) setErr((e as Error).message || "加载失败"); });
    return () => { alive = false; };
  }, [id, reload]);

  useEffect(() => {
    if (!allowed) { setResolving(false); return; }
    let alive = true;
    setResolving(true); setMediaError("");
    api.postPlayback(id)
      .then((r) => {
        if (!alive) return;
        const list = (r?.videos || []).map((v) => v?.url || "").filter(Boolean);
        if (list.length) { setSegs(list); setPlay(true); }
      })
      .catch(e => { if (alive) setMediaError(e instanceof Error ? e.message : "视频解析失败"); })
      .finally(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
  }, [id, reload, mediaRetry, allowed]);

  // Keep blocked content out of the surface while the host navigates back.
  if (currentPost && blocked) return <div className="absolute inset-0 flex items-center justify-center bg-bg" aria-label="正在返回">
    <Loader className="w-8 h-8 spinner" />
  </div>;

  return (
    <div className="ios-page absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-2 bg-s1" style={{ paddingTop: isMobile ? "var(--sat, 0px)" : 0, height: isMobile ? "calc(44px + var(--sat, 0px))" : 44 }}>
        <Button aria-label="返回" onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={19} /></Button>
        <span className="text-[14px] font-semibold text-on">吃瓜详情</span>
        <Button disabled={!currentPost} onClick={() => { if (active && allowed) setTagMenu(true); }} className="ml-auto px-3 text-[13px]">不感兴趣</Button>
      </div>

      <div role="progressbar" aria-label="阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readProgress} className="h-1 shrink-0 bg-s3 overflow-hidden"><div className="h-full bg-primary" style={{ width: `${readProgress}%` }} /></div>
      <div ref={scrollRef} data-post-scroll className="flex-1 scroll-y pb-8" onScroll={event => {
        const el = event.currentTarget;
        const range = el.scrollHeight - el.clientHeight;
        setReadProgress(range > 0 ? Math.round(el.scrollTop / range * 100) : 100);
      }}>
        {err ? (
          <Empty icon={<IFireF size={26} />} title="加载失败" sub={err} action="重试" onAction={() => setReload(n => n + 1)} />
        ) : !currentPost ? (
          <div className="flex justify-center py-12"><Loader className="w-8 h-8 spinner" /></div>
        ) : (
          <>
            <div data-post-media className="relative w-full bg-black mx-auto" style={{ height: isMobile ? "min(48vh, 420px)" : "min(60vh, 640px)" }}>
              {play && src ? (
                <Player src={src} poster={cover(currentPost.cover)} autoPlay active={active && !tagMenu} controls muted={muted}
                  onToggleMute={() => setMuted((m) => !m)} diagnosticContext={{ video_id: id, active: active && !tagMenu }} className="w-full h-full"
                  onEnded={() => {
                    /* 多段吃瓜视频：播完自动接下一段 */
                    if (seg < segs.length - 1) setSeg(seg + 1); else setPlay(false);
                  }} />
              ) : src ? (
                <Button aria-label="播放视频" onClick={() => setPlay(true)} className="absolute inset-0">
                  <Img src={currentPost.cover} eager />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center elev-2">
                        <IPlayF size={24} className="text-white ml-0.5" />
                      </span>
                    </span>
                </Button>
              ) : (
                <div className="absolute inset-0"><Img src={currentPost.cover} eager /></div>
              )}
              {resolving && !src && <div className="absolute inset-0 flex items-center justify-center gap-3 pointer-events-none bg-black/40 text-white"><Loader label="正在解析视频" /><span>正在解析视频…</span></div>}
            </div>
            {mediaError && !src && <div role="alert" className="flex flex-wrap items-center justify-center gap-3 px-4 py-3 text-[13px] text-danger"><span>{mediaError}</span><Button disabled={resolving} onClick={() => setMediaRetry(n => n + 1)}>重新解析</Button></div>}
              {segs.length > 1 && (
                <div role="group" aria-label="视频分段" className="flex items-center gap-2 px-4 py-3 overflow-x-auto">
                  {segs.map((_, i) => (
                    <Button aria-label={`第 ${i + 1} 段`} aria-pressed={i === seg} key={i} onClick={() => { setSeg(i); setPlay(true); }}
                      className="shrink-0 min-h-11 px-3 rounded-full text-[13px] font-semibold pressable"
                      style={i === seg
                        ? { background: "var(--p-primary)", color: "var(--p-on-primary)" }
                        : { background: "var(--p-s3)", color: "var(--p-on)" }}>
                      {i + 1}
                    </Button>
                  ))}
                </div>
              )}
            <div className="px-4 pt-3.5 mx-auto max-w-[800px] select-text">
              <h1 className="text-[17px] font-bold text-on leading-snug">{currentPost.title}</h1>
              <div className="flex items-center gap-2 mt-2 text-[12px] text-mut">
                <span>{currentPost.publish_time || currentPost.created_at}</span>
                <span className="flex items-center gap-1"><IFireF size={10} />{fmt(postHot(currentPost))}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {(currentPost.tags || []).filter((t) => !t.includes(HIDDEN_POST_TAG)).slice(0, 8).map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-(--r-ctl) bg-s3 text-[12px] text-on/75">#{t}</span>
                ))}
              </div>
              {currentPost.content && (
                (isHtml(currentPost.content) || (!strictSecurity && /<[a-z][\s\S]*>/i.test(currentPost.content)))
                  ? <div className="article-body mt-3.5" onClick={(e) => handleArticleClick(e, openSafeLink)} dangerouslySetInnerHTML={{ __html: safeHtml }} />
                  : <Surface className="mt-3.5 rounded-(--r-md) bg-s2 p-3.5 text-[14px] leading-relaxed text-on/80 whitespace-pre-wrap">{currentPost.content}</Surface>
              )}
            </div>
          </>
        )}
      </div>
      <TagBlockMenu open={tagMenu && active} tags={currentPost?.tags || []} onClose={() => setTagMenu(false)} onSettings={() => push({ kind: "settings", section: "内容偏好" })} />
    </div>
  );
}
