import { Button, Form, Input, SegmentedControl } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { api, fmt, isMobile } from "../api";
import type { HotSearchWord, Post, RankItem, VideoCard } from "../types";
import { useStore } from "../store";
import { MediaCard, Masonry, RankRow } from "../components/cards";
import { FilteredContent } from "../components/FilteredContent";
import { Empty } from "../components/ui";
import { useSearchResults } from "../useSearchResults";
import { SearchTags } from "../components/SearchTags";
import { IBack, IChevR, IClose, IFireF, IRefresh, ISearch, ITrophy } from "../icons";

/** 只留含中日韩字符的词：联想库里混着海外站的英文词，在中文短剧场景是噪音。 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const hasCJK = (text: string) => CJK.test(text);

/** 把命中的片段标出来：联想词里和输入重合的部分加粗。 */
function Highlight({ text, keyword }: { text: string; keyword: string }) {
  const k = keyword.trim();
  if (!k) return <>{text}</>;
  const lower = text.toLowerCase();
  const key = k.toLowerCase();
  const parts: (string | ReactElement)[] = [];
  let from = 0;
  let at = lower.indexOf(key);
  let guard = 0;
  while (at >= 0 && guard < 20) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<strong key={`${at}-${guard}`} className="font-bold text-primary">{text.slice(at, at + k.length)}</strong>);
    from = at + k.length;
    at = lower.indexOf(key, from);
    guard += 1;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

export default function Search({ active, wide }: { active: boolean; wide: boolean }) {
  const { push, toast, searchHist, addSearch, clearSearchHist, removeSearchHist, lineEpoch, accountScope } = useStore();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [tab, setTab] = useState<"video" | "post">("video");
  const results = useSearchResults();
  const { result, request, loading, error: err } = results;
  const items = result?.kind === "video" ? result.items as VideoCard[] : [];
  const posts = result?.kind === "post" ? result.items as Post[] : [];
  const count = result?.items.length ?? 0;
  const inputRef = useRef<HTMLInputElement>(null);
  const [hotWords, setHotWords] = useState<HotSearchWord[]>([]);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotError, setHotError] = useState<string | null>(null);
  const hotBusy = useRef(false);
  const hotLoadedAt = useRef(0);
  /* —— 联想：输入为空不请求，250~300ms 防抖，最多 8 条 —— */
  const [suggest, setSuggest] = useState<string[]>([]);
  const [suggestPending, setSuggestPending] = useState(false);
  const suggestSeq = useRef(0);

  useEffect(() => {
    const keyword = q.trim();
    const seq = ++suggestSeq.current;
    if (!keyword) { setSuggest([]); setSuggestPending(false); return; }
    setSuggestPending(true);
    const timer = setTimeout(() => {
      api.searchSuggest(keyword)
        .then(res => {
          if (seq !== suggestSeq.current) return;
          const words: string[] = [];
          const add = (raw?: string) => {
            const word = (raw ?? "").trim();
            if (word && hasCJK(word) && !words.includes(word) && words.length < 8) words.push(word);
          };
          /* 联想词在 phrases，但这个库里混着海外站的英文词（airbnb、人名），
             纯 ASCII 的直接丢；丢完不足 3 条再用影片标题补。 */
          const phrases = res?.phrases ?? res?.items ?? [];
          phrases.forEach(add);
          if (words.length < 3) (res?.content ?? []).forEach(item => add(item?.title));
          setSuggest(words);
        })
        .catch(() => { if (seq === suggestSeq.current) setSuggest([]); })
        .finally(() => { if (seq === suggestSeq.current) setSuggestPending(false); });
    }, 280);
    return () => clearTimeout(timer);
  }, [q]);

  /* —— 猜你想看：复用热播榜数据做 2 行横滑，不额外开接口 —— */
  const [youMayLike, setYouMayLike] = useState<RankItem[]>([]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api.rank("hot")
      .then(res => { if (!cancelled) setYouMayLike((res?.items ?? []).slice(0, 12)); })
      .catch(() => { if (!cancelled) setYouMayLike([]); });
    return () => { cancelled = true; };
  }, [active]);

  /* 排序：服务端忽略 sort 参数（实测三种值返回同一份 id 序列），所以在前端排已加载的这批 */
  const [sortBy, setSortBy] = useState<"default" | "latest" | "hot">("default");

  /* 移动端进入搜索页不自动聚焦：iOS 会立刻弹键盘遮住内容（#20）。
     桌面端没有软键盘，聚焦便于直接打字。 */
  useEffect(() => {
    if (active && !isMobile) inputRef.current?.focus();
  }, [active]);

  const refreshHot = async () => {
    if (hotBusy.current) return;
    hotBusy.current = true;
    setHotLoading(true);
    setHotError(null);
    try {
      const res = await api.searchHot();
      setHotWords(res.items ?? []);
      hotLoadedAt.current = Date.now();
    } catch (e) {
      setHotError(e instanceof Error ? e.message : "热搜榜加载失败，请重试");
    } finally {
      hotBusy.current = false;
      setHotLoading(false);
    }
  };
  useEffect(() => {
    // 切换主导航时短暂复用榜单；手动刷新始终重新获取官网内容。
    if (active && Date.now() - hotLoadedAt.current > 60_000) void refreshHot();
  }, [active]);

  const changeTab = (next: "video" | "post") => {
    if (next === tab) return;
    setTab(next);
    if (submitted) results.search(submitted, next, true);
  };

  const submit = (keyword: string) => {
    const k = keyword.trim();
    if (!k) return;
    setQ(k);
    setSubmitted(k);
    addSearch(k);
    results.search(k, tab);
  };

  const querying = submitted.length > 0;
  /* 排序只作用于已加载的这批：服务端三种排序值返回同一份结果，没法真排 */
  const sortedItems = (() => {
    const list = items.slice();
    if (sortBy === "latest") {
      const stamp = (v: VideoCard) => v.new_at || Date.parse(v.created_at ?? "") || 0;
      list.sort((a, b) => stamp(b) - stamp(a));
    } else if (sortBy === "hot") {
      list.sort((a, b) => (b.hot || 0) - (a.hot || 0));
    }
    return list;
  })();
  /* 有字但还没提交 → 输入态（联想词 + 题材 chips）；提交后改字也回到输入态 */
  const typing = q.trim().length > 0 && q.trim() !== submitted;

  return (
    <div className="ios-page ios-tint-08 absolute inset-0 bg-bg flex flex-col">
      <div className="ios-page-heading shrink-0"><h1 className="ios-page-title">搜索</h1></div>
      {/* 搜索栏 */}
      <div className="shrink-0 px-4 pb-3 flex items-center gap-2.5" >
        <Form className="ios-search-form flex-1 min-w-0 flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); submit(q); }}>
          <ISearch size={17} className="text-mut shrink-0" />
          <Input aria-label="搜索短剧、帖子、题材…" ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索短剧、帖子、题材…"
            className="flex-1 min-w-0 bg-transparent text-[14px] text-on placeholder-dim outline-none" />
          {q && <Button aria-label="清空搜索" type="button" onClick={() => { results.clear(); setQ(""); setSubmitted(""); inputRef.current?.focus(); }} className="ios-icon-button ios-search-clear"><IClose size={16} /></Button>}
        </Form>
        <Button onClick={() => push({ kind: "ranks" })} aria-label="排行榜"
          variant="primary" className="ios-icon-button ios-search-shortcut">
          <ITrophy size={19} />
        </Button>
      </div>

      <div className="flex-1 scroll-y px-4 pb-32">
        {typing ? (
          <>
            {suggest.length > 0 ? (
              <section aria-label="搜索联想" className="mt-1 a-rise">
                <ul className="ios-suggest-list">
                  {suggest.map((word) => (
                    <li key={word}>
                      <Button className="ios-suggest-item" onClick={() => submit(word)} aria-label={`搜索 ${word}`}>
                        <ISearch size={15} className="text-dim shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-[14px] text-on"><Highlight text={word} keyword={q} /></span>
                        <IChevR size={14} className="text-dim shrink-0" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : suggestPending ? (
              <p role="status" className="px-1 py-2 text-[12px] text-mut">正在联想…</p>
            ) : null}
            <SearchTags key={JSON.stringify([lineEpoch, accountScope])} active={active} />
          </>
        ) : !querying ? (
          <>
            {searchHist.length > 0 && (
              <div className="mt-1 a-rise">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-bold text-on">搜索历史</span>
                  <Button onClick={clearSearchHist} className="text-[12px] text-dim pressable">清空</Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {searchHist.map((h) => (
                    <span key={h} className="hg-hist-chip">
                      <Button onClick={() => { setQ(h); submit(h); }} className="hg-hist-word">{h}</Button>
                      <Button onClick={() => removeSearchHist(h)} aria-label={`删除历史 ${h}`} className="hg-hist-del"><IClose size={12} /></Button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <section aria-label="热搜榜" className="mt-1 a-rise">
                <div className="flex items-center justify-between px-1">
                  <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-on/90"><IFireF size={15} className="text-primary" />热搜榜</h2>
                  <Button onClick={() => void refreshHot()} disabled={hotLoading} aria-label="刷新热搜榜"
                    className="flex items-center gap-1 px-2 text-[12px] text-mut pressable">
                    {hotLoading ? <Loader className="w-3 h-3" /> : <IRefresh size={12} />}{hotLoading ? "刷新中" : "刷新"}
                  </Button>
                </div>
                {hotError && <p role="status" className="mt-2 text-[12px] text-mut leading-relaxed">
                  {hotWords.length > 0 ? "刷新失败，保留上次榜单。" : "热搜榜暂不可用。"}{hotError}
                </p>}
                {hotWords.length > 0 ? (
                  <ol className="ios-search-hot-grid mt-3" aria-busy={hotLoading}>
                    {hotWords.map((item, i) => (
                      <li key={`${item.word}-${i}`} className="min-w-0">
                        <Button aria-label={`搜索 ${item.word}`} title={item.word} className="ios-search-hot-item"
                          onClick={() => submit(item.word)}>
                          <span aria-hidden="true" className={`ios-search-hot-rank ${i < 3 ? "text-primary" : "text-mut"}`}>{String(i + 1).padStart(2, "0")}</span>
                          <span className="ios-search-hot-content">
                            <span className="ios-search-hot-title">{item.word}</span>
                            {Number.isFinite(item.heat) && item.heat > 0 && <span className="ios-search-hot-plays">{fmt(item.heat)} 热度</span>}
                          </span>
                          <IChevR size={15} className="text-mut" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                ) : !hotError && <p role="status" className="mt-3 px-1 text-[12px] text-mut">{hotLoading ? "加载中…" : "暂无热搜词"}</p>}
              </section>

            {youMayLike.length > 0 && (
              <section aria-label="猜你想看" className="mt-5 a-rise">
                <h2 className="text-[14px] font-bold text-on mb-2.5">猜你想看</h2>
                <div className="hg-youlike">
                  {youMayLike.map((item) => (
                    <MediaCard key={`${item.video_id}-${item.rank}`} title={item.title} cover={item.cover}
                      badge={typeof item.score === "number" && item.score > 0 ? `${item.score.toFixed(1)} 分` : undefined}
                      subtitle={item.tags?.slice(0, 2).join(" · ") || item.metric_label}
                      onOpen={() => push({ kind: "feed", videoIds: youMayLike.map(x => x.video_id), index: youMayLike.findIndex(x => x.video_id === item.video_id), title: "猜你想看" })} />
                  ))}
                </div>
              </section>
            )}

            <SearchTags key={JSON.stringify([lineEpoch, accountScope])} active={active} />
            <p className="mt-3 text-[12px] text-dim leading-relaxed">
              输入关键词后按回车搜索，也可以点上面的题材直接看片单。
            </p>
          </>
        ) : (
          <>
            <SegmentedControl className="mt-1 mb-3" aria-label="搜索结果类型" activeIndex={tab === "video" ? 0 : 1}>
              {([["video", "视频"], ["post", "帖子"]] as const).map(([k, label]) => (
                <Button aria-pressed={tab === k} key={k} onClick={() => changeTab(k)}>{label}</Button>
              ))}
            </SegmentedControl>
            <div role="status" className="text-[12px] text-mut mb-2.5" aria-live="polite">
              {loading && <span className="block">{request?.page === 1 ? `正在搜索「${submitted}」…` : "正在加载更多…"}</span>}
              {result && <>「{result.keyword}」已加载 <span className="text-primary font-bold">{count}{result.total !== null ? ` / ${result.total}` : ""}</span> 条{result.kind === "post" ? "帖子" : "视频"}</>}
            </div>
            {tab === "video" && count > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <div className="flex gap-2" role="group" aria-label="结果排序">
                  {([["default", "综合"], ["latest", "最新"], ["hot", "最热"]] as const).map(([key, label]) => (
                    <Button key={key} className="ios-filter-pill" aria-pressed={sortBy === key}
                      onClick={() => { if (key === sortBy) return; setSortBy(key); if (key !== "default") toast("排序只对已加载的结果生效"); }}>{label}</Button>
                  ))}
                </div>
                {sortBy !== "default" && <span className="ml-auto text-[11px] text-dim">仅排已加载 {count} 条</span>}
              </div>
            )}
            {err && <div role="alert" className="flex flex-wrap items-center gap-2 mb-3 text-[13px] text-danger">
              <span>「{submitted}」{request?.page && request.page > 1 ? "加载更多失败" : "搜索失败"}：{err}</span>
              <Button onClick={results.retry} disabled={loading} className="px-3 text-primary">重试</Button>
            </div>}
            <section aria-label="搜索结果" aria-busy={loading}>
              {result && count > 0 ? <>
                {result.kind === "video" ? (
                  <Masonry videos={sortedItems} scopeKey={JSON.stringify([submitted, tab, result.keyword, result.kind])} wide={wide} onOpen={(v) => push({ kind: "feed", videoIds: sortedItems.map((x) => x.id), index: sortedItems.findIndex((x) => x.id === v.id), title: `搜索 · ${result.keyword}` })} />
                ) : (
                  <FilteredContent items={posts} scopeKey={JSON.stringify([submitted, tab, result.keyword, result.kind])}>{visible => <div className={`ios-media-grid ${wide ? "is-wide" : ""}`}>
                    {visible.map((post) => (
                      <MediaCard key={post.id} title={post.title} cover={post.cover} subtitle={`${fmt(post.hot)} 次浏览`} onOpen={() => push({ kind: "post", id: post.id })} />
                    ))}
                  </div>}</FilteredContent>
                )}
                <div className="flex justify-center py-4">
                  {loading ? <Loader label="搜索结果更新中" className="w-6 h-6 spinner" />
                    : !err && result.keyword === submitted && (result.page < result.pages ? (
                      <Button onClick={results.loadMore} className="px-5 h-9 rounded-(--r-ctl) bg-s3 text-[13px] text-on/85 pressable">加载更多</Button>
                    ) : <span className="text-[12px] text-dim">— 已经到底啦 —</span>)}
                </div>
              </> : loading ? (
                <div className="flex justify-center py-12"><Loader label="正在搜索" className="w-8 h-8 spinner" /></div>
              ) : !err && (
                <div className="py-10 text-center a-rise">
                  <ISearch size={26} className="mx-auto text-dim" />
                  <p className="mt-3 text-[15px] font-semibold text-on">没有找到「{submitted}」</p>
                  <p className="mt-1.5 text-[12px] text-mut leading-relaxed">换个关键词试试，或者直接看热搜榜在追什么</p>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <Button className="ios-filter-pill" onClick={() => { results.clear(); setSubmitted(""); setQ(""); setTimeout(() => inputRef.current?.focus(), 60); }}>换个关键词</Button>
                    <Button className="ios-filter-pill" aria-pressed onClick={() => { results.clear(); setSubmitted(""); setQ(""); }}>看看热榜</Button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/* ================= 排行榜 ================= */
const RANK_TABS = [
  { k: "hot", label: "热播榜", desc: "按热力指数排序" },
  { k: "recommend", label: "推荐榜", desc: "按推荐值排序" },
  { k: "potential", label: "潜力榜", desc: "按潜力值排序" },
] as const;

export function RankPage({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { push } = useStore();
  type RankKind = typeof RANK_TABS[number]["k"];
  type RankState = { items: RankItem[]; loadedAt: number; loading: boolean; error: string };
  const [tab, setTab] = useState<RankKind>("hot");
  const [states, setStates] = useState<Partial<Record<RankKind, RankState>>>({});
  const cache = useRef<Partial<Record<RankKind, RankState>>>({});
  const pending = useRef(new Set<RankKind>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async (kind: RankKind) => {
    if (pending.current.has(kind)) return;
    pending.current.add(kind);
    const previous = cache.current[kind];
    const update = (state: RankState) => {
      cache.current[kind] = state;
      if (alive.current) setStates(current => ({ ...current, [kind]: state }));
    };
    update({ items: previous?.items ?? [], loadedAt: previous?.loadedAt ?? 0, loading: true, error: "" });
    try {
      const res = await api.rank(kind);
      update({ items: res?.items || [], loadedAt: Date.now(), loading: false, error: "" });
    } catch (error) {
      update({ items: previous?.items ?? [], loadedAt: previous?.loadedAt ?? 0, loading: false,
        error: error instanceof Error ? error.message : "榜单加载失败，请重试" });
    } finally { pending.current.delete(kind); }
  };
  useEffect(() => {
    if (!cache.current[tab]?.loadedAt || Date.now() - cache.current[tab]!.loadedAt > 60_000) void load(tab);
  }, [tab]);
  const state = states[tab];
  const items = state?.items ?? [];
  const loading = state?.loading ?? true;
  const err = state?.error ?? "";
  const max = Math.max(1, ...items.map((x) => x.metric_value || 0));
  const meta = RANK_TABS.find((t) => t.k === tab)!;

  return (
    <div className="ios-page ios-tint-08 absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 relative overflow-hidden bg-s1" style={{ paddingTop: "var(--sat, 0px)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(90% 120% at 100% 0%, var(--p-pc) 0%, transparent 60%)", opacity: 0.32 }} />
        <div className="relative pt-2 pb-4">
          <Button aria-label="返回" onClick={onBack} className="w-10 h-10 rounded-full flex items-center justify-center text-on hover:bg-s3 pressable"><IBack size={20} /></Button>
          <div className="mt-1 flex flex-wrap gap-2 items-end justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-(--r-sm) bg-pc text-on-pc flex items-center justify-center"><ITrophy size={20} /></span>
                <h1 className="text-[24px] font-bold tracking-wide text-on">HGuoX 热榜</h1>
              </div>
              <div className="text-[12px] text-mut mt-1">{meta.desc}</div>
            </div>
            <Button aria-label="刷新榜单" disabled={loading} onClick={() => void load(tab)} className="ios-icon-button">
              {loading ? <Loader label="正在更新榜单" className="w-4 h-4" /> : <IRefresh size={18} />}
            </Button>
          </div>
          <SegmentedControl className="mt-3" aria-label="榜单类型" activeIndex={RANK_TABS.findIndex(item => item.k === tab)}>
            {RANK_TABS.map((t) => (
              <Button aria-pressed={tab === t.k} key={t.k} onClick={() => setTab(t.k)}>{t.label}</Button>
            ))}
          </SegmentedControl>
        </div>
      </div>

      <div className="flex-1 scroll-y px-3.5 pt-3 pb-8">
        {err && <div role="alert" className="flex flex-wrap items-center gap-2 mb-3 text-[13px] text-danger">
          <span>榜单加载失败：{err}{items.length > 0 ? "；已保留上次榜单" : ""}</span>
          <Button onClick={() => void load(tab)} disabled={loading} className="px-3 text-primary">重试</Button>
        </div>}
        <section aria-label={meta.label} aria-busy={loading}>
          {items.length > 0 ? <>
            {loading && <p role="status" className="text-[12px] text-mut mb-2">正在刷新，当前显示上次榜单…</p>}
            <FilteredContent items={items} scopeKey={tab}>{visible => visible.map((it) => (
              <RankRow key={`${it.video_id}-${it.rank}`} item={it} metricMax={max}
                onOpen={() => push({ kind: "feed", videoIds: items.map((x) => x.video_id), index: items.findIndex((x) => x.video_id === it.video_id), title: meta.label })} />
            ))}</FilteredContent>
          </> : loading ? (
            <div className="flex justify-center py-12"><Loader label="正在加载榜单" className="w-8 h-8 spinner" /></div>
          ) : !err && (
            <Empty icon={<ITrophy size={26} />} title="榜单暂时为空" sub="稍后再来看看，或者去首页刷刷推荐" />
          )}
        </section>
        {items.length > 0 && <p className="py-4 text-center text-[12px] text-dim">榜单仅提供 {items.length} 条</p>}
        {wide && <div className="h-2" />}
      </div>
    </div>
  );
}
