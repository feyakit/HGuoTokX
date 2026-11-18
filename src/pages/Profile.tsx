import { Button, Surface } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { useEffect, useRef, useState } from "react";
import { api, APP_VERSION, fmtTime, platform } from "../api";
import type { Detail, Post } from "../types";
import { useStore } from "../store";
import { Empty, Img, Modal } from "../components/ui";
import { MediaCard } from "../components/cards";
import { useContentPreferences } from "../contentPreferences";
import { IBack, IChevR, IClock, ILogout, IMenuFollow, IMenuHistory, IMenuLikes, IMenuPrefs, ISettings, IStar } from "../icons";

function GuestCatAvatar() {
  return (
    <svg viewBox="0 0 72 72" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="cat-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <circle cx="36" cy="36" r="36" fill="url(#cat-sky)" />
      {/* Black cat silhouette */}
      <path d="M20 58c0-11 7-18 16-18s16 7 16 18Z" fill="#0B0C14" />
      <path d="M21 20l4 13c3-2 7-3 11-3s8 1 11 3l4-13 6 15c1 7-4 15-17 15s-18-8-17-15Z" fill="#0B0C14" />
      <circle cx="29" cy="36" r="2.6" fill="#FDE047" />
      <circle cx="43" cy="36" r="2.6" fill="#FDE047" />
      <circle cx="29.6" cy="35.6" r="1.1" fill="#0B0C14" />
      <circle cx="43.6" cy="35.6" r="1.1" fill="#0B0C14" />
    </svg>
  );
}

/* Account changes discard cached details synchronously, before another account can paint. */
export default function Profile({ wide }: { wide: boolean }) {
  const { accountScope } = useStore();
  return <ProfileContent key={accountScope} wide={wide} />;
}

function ProfileContent({ wide: _wide }: { wide: boolean }) {
  const { user, setLoginOpen, logout, history, favs, postFavs, follows, push, accountSync, syncAccount } = useStore();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutPending = useRef(false);
  const mounted = useRef(true);
  const [stats, setStats] = useState<{ followers: number; post_count: number; video_count: number } | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!user?.id) { setStats(null); return; }
    let alive = true;
    api.userStats(user.id).then((res) => {
      if (alive && res) setStats({ followers: res.followers ?? 0, post_count: res.post_count ?? 0, video_count: res.video_count ?? 0 });
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  const confirmLogout = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLogoutBusy(true);
    setLogoutError("");
    try {
      await logout();
      if (mounted.current) setLogoutOpen(false);
    } catch (error) {
      if (mounted.current) setLogoutError(error instanceof Error ? error.message : "退出失败，请重试");
    } finally {
      logoutPending.current = false;
      if (mounted.current) setLogoutBusy(false);
    }
  };

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <h1 className="sr-only">我的</h1>

      <div className="ios-page-body flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: "calc(110px + var(--sab, 0px))" }}>
        {/* Page 4 资料头：72px 头像 + 昵称 / ID + 右齿轮（唯一设置入口） */}
        <div className="hg-profile-head a-rise">
          {user ? (
            <Button card className="hg-profile-guest" onClick={() => push({ kind: "user", id: user.id, name: user.nickname })}>
              <span className="hg-profile-avatar">
                {user.avatar ? <Img src={user.avatar} eager /> : <GuestCatAvatar />}
              </span>
              <span className="hg-profile-meta">
                <span className="hg-profile-name">{user.nickname || user.username}</span>
                <span className="hg-profile-sub">ID:{user.id}</span>
              </span>
            </Button>
          ) : (
            <Button card className="hg-profile-guest" aria-label="未登录，点击登录"
              onClick={() => setLoginOpen(true)}>
              <span className="hg-profile-avatar is-guest"><GuestCatAvatar /></span>
              <span className="hg-profile-meta">
                <span className="hg-profile-name">未登录</span>
                <span className="hg-profile-sub">点击登录同步收藏与观看记录</span>
              </span>
            </Button>
          )}
          <Button card className="hg-icon-plain" aria-label="打开设置"
            onClick={() => push({ kind: "settings" })}><ISettings size={22} strokeWidth={1.7} /></Button>
        </div>

        {/* 3 列数据统计：关注 / 粉丝 / 作品 */}
        <div className="hg-profile-stats">
          <Button card className="hg-profile-stat" onClick={() => user ? push({ kind: "following" }) : setLoginOpen(true)}>
            <span className="hg-profile-stat-num">{follows.length}</span>
            <span className="hg-profile-stat-lbl">关注</span>
          </Button>
          <Button card className="hg-profile-stat" onClick={() => user ? push({ kind: "user", id: user.id, name: user.nickname }) : setLoginOpen(true)}>
            <span className="hg-profile-stat-num">{stats?.followers ?? user?.counts?.followers ?? user?.counts?.follower_count ?? 0}</span>
            <span className="hg-profile-stat-lbl">粉丝</span>
          </Button>
          <Button card className="hg-profile-stat" onClick={() => user ? push({ kind: "user", id: user.id, name: user.nickname }) : setLoginOpen(true)}>
            <span className="hg-profile-stat-num">{stats?.post_count ?? stats?.video_count ?? user?.counts?.posts ?? user?.counts?.post_count ?? user?.counts?.videos ?? 0}</span>
            <span className="hg-profile-stat-lbl">作品</span>
          </Button>
        </div>

        {!user && (
          <Button card className="hg-profile-login-cta" onClick={() => setLoginOpen(true)}>
            登录 / 注册
          </Button>
        )}

        {user && accountSync.error && <div role="alert" className="mt-3 rounded-(--r-sm) bg-s3 p-3 text-[13px]">
          <p className="text-danger break-words">{accountSync.error}</p>
          <Button disabled={accountSync.busy} onClick={() => { void syncAccount().catch(() => {}); }}
            className="mt-1 min-h-11 px-3 text-on">{accountSync.busy ? "正在重试…" : "重试同步"}</Button>
        </div>}

        {/* 菜单列表：全部压入标准二级路由栈，手势/安卓物理返回键完全一致 */}
        <div className="hg-menu">
          <Button className="hg-menu-row" aria-label="观看历史" onClick={() => push({ kind: "history" })}>
            <span className="hg-menu-icon"><IMenuHistory size={19} strokeWidth={1.75} /></span>
            <span className="hg-menu-label">观看历史</span>
            <span className="hg-menu-meta" aria-hidden="true">{history.length}</span>
            <IChevR size={14} className="hg-menu-chevron" />
          </Button>
          <Button className="hg-menu-row" aria-label="我的收藏" onClick={() => push({ kind: "favorites" })}>
            <span className="hg-menu-icon"><IMenuLikes size={19} strokeWidth={1.75} /></span>
            <span className="hg-menu-label">我的收藏</span>
            <span className="hg-menu-meta" aria-hidden="true">{favs.length + postFavs.length}</span>
            <IChevR size={14} className="hg-menu-chevron" />
          </Button>
          <Button className="hg-menu-row" aria-label="我的关注" onClick={() => user ? push({ kind: "following" }) : setLoginOpen(true)}>
            <span className="hg-menu-icon"><IMenuFollow size={19} strokeWidth={1.75} /></span>
            <span className="hg-menu-label">我的关注</span>
            <span className="hg-menu-meta" aria-hidden="true">{follows.length}</span>
            <IChevR size={14} className="hg-menu-chevron" />
          </Button>
          <Button className="hg-menu-row" aria-label="内容偏好" onClick={() => push({ kind: "settings", section: "内容偏好" })}>
            <span className="hg-menu-icon"><IMenuPrefs size={19} strokeWidth={1.75} /></span>
            <span className="hg-menu-label">内容偏好</span>
            <IChevR size={14} className="hg-menu-chevron" />
          </Button>
          {user && (
            <Button className="hg-menu-row" onClick={() => { setLogoutError(""); setLogoutOpen(true); }}>
              <span className="hg-menu-icon"><ILogout size={19} strokeWidth={1.75} /></span>
              <span className="hg-menu-label">退出登录</span>
              <IChevR size={14} className="hg-menu-chevron" />
            </Button>
          )}
        </div>

        <div className="text-center text-[12px] text-dim mt-6">HGuoX {APP_VERSION} · {platform === "android" ? "Android" : platform === "ios" ? "iOS" : platform === "macos" ? "macOS" : platform === "linux" ? "Linux" : "Windows"} 客户端</div>
      </div>

      <Modal open={logoutOpen} onClose={() => { if (!logoutPending.current) setLogoutOpen(false); }} label="退出登录">
        <div className="p-5">
          <h2 className="text-[18px] font-bold">退出登录</h2>
          <p className="mt-2 text-[14px] text-mut">退出当前账户？账号数据和本机进度会保留，退出后显示游客的本机记录。</p>
          {logoutError && <p role="alert" className="mt-3 text-[13px] text-danger">{logoutError}</p>}
          <div className="mt-4 flex gap-3">
            <Button variant="secondary" disabled={logoutBusy} onClick={() => setLogoutOpen(false)} className="flex-1">取消</Button>
            <Button variant="danger" disabled={logoutBusy} onClick={() => void confirmLogout()} className="flex-1 rounded-(--r-ctl) px-3">
              {logoutBusy ? "正在退出…" : "确认退出"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= 二级栈页：观看历史 ================= */
export function HistoryPage({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { accountScope } = useStore();
  return <HistoryContent key={accountScope} onBack={onBack} wide={wide} />;
}

function HistoryContent({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { blockReason } = useContentPreferences();
  const { user, history, clearHistory, push, setTab } = useStore();
  const [cache, setCache] = useState<Record<number, Detail>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [limit, setLimit] = useState(12);
  const [failedIds, setFailedIds] = useState<number[]>([]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState("");
  const clearing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const ids = history.map((h) => h.id);
  const visibleIds = ids.slice(0, limit);
  const cards = visibleIds.map(id => cache[id]).filter((card): card is Detail => !!card);
  const failed = failedIds.filter(id => visibleIds.includes(id));
  const idsKey = visibleIds.join(",");
  const progressOf = (id: number) => history.find((h) => h.id === id);

  useEffect(() => {
    let alive = true;
    const missing = visibleIds.filter(id => !cacheRef.current[id]);
    setFailedIds([]);
    if (!missing.length) { setLoading(false); return; }
    setLoading(true);
    Promise.allSettled(missing.map(id => api.video(id)))
      .then(results => {
        if (!alive) return;
        const loaded: Record<number, Detail> = {};
        const nextFailed: number[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") loaded[missing[index]] = result.value;
          else nextFailed.push(missing[index]);
        });
        setCache(previous => ({ ...previous, ...loaded }));
        setFailedIds(nextFailed);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [idsKey, reload]);

  const clearWatchHistory = async () => {
    if (clearing.current) return;
    clearing.current = true;
    setClearBusy(true); setClearError("");
    try {
      await clearHistory();
      if (mounted.current) setClearOpen(false);
    } catch (error) {
      if (mounted.current) setClearError(error instanceof Error ? error.message : "清空失败，观看记录已保留，请重试");
    } finally {
      clearing.current = false;
      if (mounted.current) setClearBusy(false);
    }
  };

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <div className="flex items-center gap-3 hg-page-x shrink-0 relative z-10"
        style={{ paddingTop: "calc(var(--sat, 0px) + 10px)", paddingBottom: 10 }}>
        <Button card className="hg-icon-plain" aria-label="返回" onClick={onBack}>
          <IBack size={20} />
        </Button>
        <h1 className="text-[18px] font-bold text-on flex-1">观看历史</h1>
        {history.length > 0 && (
          <Button aria-label="清空观看历史" disabled={clearBusy} onClick={() => { setClearError(""); setClearOpen(true); }}
            className="px-3 h-8 rounded-full bg-s3 text-[12px] text-mut">
            {clearBusy ? "正在清空…" : "清空"}
          </Button>
        )}
      </div>

      <div className="flex-1 scroll-y hg-page-x relative z-10" style={{ paddingBottom: "calc(32px + var(--sab, 0px))" }}
        aria-busy={loading}>
        {loading && !cards.length ? (
          <div className="flex justify-center py-8"><Loader className="w-7 h-7 spinner" /></div>
        ) : cards.length ? (
          <div className={`ios-media-grid ${wide ? "is-wide" : ""}`}>
            {cards.map((c) => {
              const progress = progressOf(c.id);
              return (
                <MediaCard key={c.id} blockedReason={blockReason(c.tags)} title={c.title} cover={c.cover} score={c.score}
                  badge={c.is_finished ? "已完结" : `${c.episode_count} 集`}
                  subtitle={c.tags?.slice(0, 2).join(" · ")}
                  progress={progress ? `第 ${progress.ep} 集 · ${fmtTime(progress.t)}` : undefined}
                  onOpen={() => push({
                    kind: "feed", videoIds: cards.map(x => x.id), index: cards.findIndex(x => x.id === c.id),
                    title: "观看历史", startEp: progress?.ep, startTime: progress?.t,
                  })} />
              );
            })}
          </div>
        ) : failed.length ? (
          <Empty icon={<IClock size={24} />} title="观看记录加载失败"
            sub="记录仍在，重试后继续浏览。" action="重试" onAction={() => setReload(n => n + 1)} />
        ) : (
          <Empty icon={<IClock size={24} />} title="还没有观看记录"
            sub="看过的剧集会出现在这里"
            action="去逛逛" onAction={() => { onBack(); setTab("home"); }} />
        )}
        {cards.length > 0 && failed.length > 0 && (
          <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-mut">
            <span>{failed.length} 项内容加载失败，已加载内容仍可浏览。</span>
            <Button disabled={loading} onClick={() => setReload(n => n + 1)} className="px-3 text-primary">重试失败内容</Button>
          </div>
        )}
        {cards.length > 0 && loading && <div className="flex justify-center py-3"><Loader label="加载更多内容" /></div>}
        {visibleIds.length < ids.length && (
          <Button disabled={loading} onClick={() => setLimit(prev => prev + 12)}
            className="mt-3 w-full rounded-(--r-ctl) bg-s3 text-[13px] text-on">加载更多</Button>
        )}
        {clearError && !clearOpen && <p role="alert" className="mt-2 text-[13px] text-danger">{clearError}</p>}
      </div>

      <Modal open={clearOpen} onClose={() => { if (!clearing.current) setClearOpen(false); }} label="清空观看历史">
        <div className="p-5">
          <h2 className="text-[18px] font-bold">清空观看历史</h2>
          <p className="mt-2 text-[14px] text-mut">确认清空全部观看历史？{user ? "当前账号的云端观看历史与本机缓存都会被清除。" : "本机游客观看历史会被清除。"}此操作无法撤销，收藏不会受影响。</p>
          {clearError && <p role="alert" className="mt-3 text-[13px] text-danger">{clearError}</p>}
          <div className="mt-4 flex gap-3">
            <Button variant="secondary" disabled={clearBusy} onClick={() => setClearOpen(false)} className="flex-1">取消</Button>
            <Button variant="danger" disabled={clearBusy} aria-busy={clearBusy} onClick={() => void clearWatchHistory()} className="flex-1 rounded-(--r-ctl) px-3">
              {clearBusy ? "正在清空…" : "确认清空"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ================= 二级栈页：我的收藏 ================= */
export function FavoritesPage({ onBack, wide, initialTab = "video" }: { onBack: () => void; wide: boolean; initialTab?: "video" | "post" }) {
  const { accountScope } = useStore();
  return <FavoritesContent key={accountScope} onBack={onBack} wide={wide} initialTab={initialTab} />;
}

function FavoritesContent({ onBack, wide, initialTab }: { onBack: () => void; wide: boolean; initialTab: "video" | "post" }) {
  const { blockReason } = useContentPreferences();
  const { user, favs, postFavs, push, setTab, accountSync, syncAccount } = useStore();
  const [favTab, setFavTab] = useState<"video" | "post">(initialTab);
  const [cache, setCache] = useState<Record<number, Detail>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [postCache, setPostCache] = useState<Record<number, Post>>({});
  const postCacheRef = useRef(postCache);
  postCacheRef.current = postCache;
  const [limits, setLimits] = useState({ video: 12, post: 12 });
  const [failedIds, setFailedIds] = useState<number[]>([]);
  const [postFailedIds, setPostFailedIds] = useState<number[]>([]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [postLoading, setPostLoading] = useState(false);

  const visibleIds = favs.slice(0, limits.video);
  const cards = visibleIds.map(id => cache[id]).filter((card): card is Detail => !!card);
  const failed = failedIds.filter(id => visibleIds.includes(id));
  const idsKey = visibleIds.join(",");

  const visiblePostIds = postFavs.slice(0, limits.post);
  const postCards = visiblePostIds.map(id => postCache[id]).filter((p): p is Post => !!p);
  const postFailed = postFailedIds.filter(id => visiblePostIds.includes(id));
  const postIdsKey = visiblePostIds.join(",");

  const favoriteStateUnknown = !!user && !accountSync.favoritesKnown && favs.length === 0 && postFavs.length === 0;
  const favoriteSyncFailed = favoriteStateUnknown && !accountSync.busy;
  const syncingFavorites = favoriteStateUnknown && !favoriteSyncFailed;

  useEffect(() => {
    if (favTab !== "video") return;
    let alive = true;
    const missing = visibleIds.filter(id => !cacheRef.current[id]);
    setFailedIds([]);
    if (!missing.length) { setLoading(false); return; }
    setLoading(true);
    Promise.allSettled(missing.map(id => api.video(id)))
      .then(results => {
        if (!alive) return;
        const loaded: Record<number, Detail> = {};
        const nextFailed: number[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") loaded[missing[index]] = result.value;
          else nextFailed.push(missing[index]);
        });
        setCache(previous => ({ ...previous, ...loaded }));
        setFailedIds(nextFailed);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [idsKey, favTab, reload]);

  useEffect(() => {
    if (favTab !== "post") return;
    let alive = true;
    const missing = visiblePostIds.filter(id => !postCacheRef.current[id]);
    setPostFailedIds([]);
    if (!missing.length) { setPostLoading(false); return; }
    setPostLoading(true);
    Promise.allSettled(missing.map(id => api.post(id)))
      .then(results => {
        if (!alive) return;
        const loaded: Record<number, Post> = {};
        const nextFailed: number[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") loaded[missing[index]] = result.value;
          else nextFailed.push(missing[index]);
        });
        setPostCache(previous => ({ ...previous, ...loaded }));
        setPostFailedIds(nextFailed);
        setPostLoading(false);
      });
    return () => { alive = false; };
  }, [postIdsKey, favTab, reload]);

  return (
    <div className="ios-page hg-canvas absolute inset-0 flex flex-col">
      <span className="hg-aura" aria-hidden="true" />
      <div className="flex items-center gap-3 hg-page-x shrink-0 relative z-10"
        style={{ paddingTop: "calc(var(--sat, 0px) + 10px)", paddingBottom: 10 }}>
        <Button card className="hg-icon-plain" aria-label="返回" onClick={onBack}>
          <IBack size={20} />
        </Button>
        <h1 className="text-[18px] font-bold text-on flex-1">我的收藏</h1>
      </div>

      <div className="shrink-0 hg-page-x pb-3 relative z-10">
        <div className="hg-pill-row" role="tablist" aria-label="收藏分类">
          <Button card role="tab" aria-selected={favTab === "video"}
            className="hg-pill"
            onClick={() => setFavTab("video")}>短剧 ({favs.length})</Button>
          <Button card role="tab" aria-selected={favTab === "post"}
            className="hg-pill"
            onClick={() => setFavTab("post")}>吃瓜 ({postFavs.length})</Button>
        </div>
      </div>

      <div className="flex-1 scroll-y hg-page-x relative z-10" style={{ paddingBottom: "calc(32px + var(--sab, 0px))" }}
        aria-busy={(favTab === "post" ? postLoading : loading) || syncingFavorites}>
        {favoriteSyncFailed ? (
          <Empty icon={<IStar size={24} />} title="收藏状态未知"
            sub="账号同步未完成，暂时无法确认收藏内容。" action="重试"
            onAction={() => { void syncAccount().catch(() => {}); }} />
        ) : syncingFavorites ? (
          <FavoriteSyncState wide={wide} />
        ) : favTab === "post" ? (
          <>
            {postLoading && !postCards.length ? (
              <div className="flex justify-center py-8"><Loader className="w-7 h-7 spinner" /></div>
            ) : postCards.length ? (
              <div className="hg-post-feed">
                {postCards.map((p) => (
                  <div key={p.id} className="hg-post-card" onClick={() => push({ kind: "post", id: p.id })}>
                    <div className="hg-post-head">
                      <span className="hg-post-who">
                        <span className="hg-post-name">{p.author?.name || "吃瓜帖"}</span>
                        <span className="hg-post-time">{p.publish_time || p.created_at}</span>
                      </span>
                    </div>
                    <div className="hg-post-title">{p.title}</div>
                    {p.cover && (
                      <div className="hg-post-art">
                        <Img src={p.cover} alt="" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : postFailed.length ? (
              <Empty icon={<IStar size={24} />} title="收藏帖子加载失败"
                sub="记录仍在，重试后继续浏览。" action="重试" onAction={() => setReload(n => n + 1)} />
            ) : (
              <Empty icon={<IStar size={24} />} title="还没有收藏的吃瓜帖"
                sub="在吃瓜详情页点收藏，之后就能在这里找到"
                action="去吃瓜看看" onAction={() => { onBack(); setTab("posts"); }} />
            )}
            {postCards.length > 0 && postFailed.length > 0 && (
              <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-mut">
                <span>{postFailed.length} 篇帖子加载失败，已加载内容仍可浏览。</span>
                <Button disabled={postLoading} onClick={() => setReload(n => n + 1)} className="px-3 text-primary">重试失败内容</Button>
              </div>
            )}
            {postCards.length > 0 && postLoading && <div className="flex justify-center py-3"><Loader label="加载更多内容" /></div>}
            {visiblePostIds.length < postFavs.length && (
              <Button disabled={postLoading} onClick={() => setLimits(prev => ({ ...prev, post: prev.post + 12 }))}
                className="mt-3 w-full rounded-(--r-ctl) bg-s3 text-[13px] text-on">加载更多</Button>
            )}
          </>
        ) : (
          <>
            {loading && !cards.length ? (
              <div className="flex justify-center py-8"><Loader className="w-7 h-7 spinner" /></div>
            ) : cards.length ? (
              <div className={`ios-media-grid ${wide ? "is-wide" : ""}`}>
                {cards.map((c) => (
                  <MediaCard key={c.id} blockedReason={blockReason(c.tags)} title={c.title} cover={c.cover} score={c.score}
                    badge={c.is_finished ? "已完结" : `${c.episode_count} 集`}
                    subtitle={c.tags?.slice(0, 2).join(" · ")}
                    onOpen={() => push({ kind: "series", id: c.id })} />
                ))}
              </div>
            ) : failed.length ? (
              <Empty icon={<IStar size={24} />} title="收藏加载失败"
                sub="记录仍在，重试后继续浏览。" action="重试" onAction={() => setReload(n => n + 1)} />
            ) : (
              <Empty icon={<IStar size={24} />} title="还没有喜欢的内容"
                sub="在剧集详情页点收藏，之后就能在这里找到"
                action="去逛逛" onAction={() => { onBack(); setTab("category"); }} />
            )}
            {cards.length > 0 && failed.length > 0 && (
              <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-mut">
                <span>{failed.length} 项内容加载失败，已加载内容仍可浏览。</span>
                <Button disabled={loading} onClick={() => setReload(n => n + 1)} className="px-3 text-primary">重试失败内容</Button>
              </div>
            )}
            {cards.length > 0 && loading && <div className="flex justify-center py-3"><Loader label="加载更多内容" /></div>}
            {visibleIds.length < favs.length && (
              <Button disabled={loading} onClick={() => setLimits(prev => ({ ...prev, video: prev.video + 12 }))}
                className="mt-3 w-full rounded-(--r-ctl) bg-s3 text-[13px] text-on">加载更多</Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FavoriteSyncState({ wide }: { wide: boolean }) {
  return <>
    <div role="status" aria-live="polite" aria-label="正在同步收藏"
      className="mb-4 flex items-center justify-center gap-2.5 text-[13px] text-mut">
      <span aria-hidden="true" className="ios-loader spinner w-5 h-5" />
      <span>正在同步收藏…</span>
    </div>
    <div aria-hidden="true" className={`ios-media-grid ${wide ? "is-wide" : ""}`}>
      {[0, 1, 2, 3].map(index => (
        <div key={index} className="min-w-0">
          <div className="hg-skel-poster w-full rounded-[22px] bg-s3 animate-pulse" />
          <div className="mt-2.5 h-3.5 w-4/5 rounded-full bg-s3 animate-pulse" />
          <div className="mt-2 h-3 w-1/2 rounded-full bg-s2 animate-pulse" />
        </div>
      ))}
    </div>
  </>;
}
