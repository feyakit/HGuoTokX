import { Button, SegmentedControl, Surface } from "../components/ios/controls";
import { Loader } from "../components/ios/effects";
import { useEffect, useRef, useState } from "react";
import { api, APP_VERSION, fmt, fmtTime, isMobile, platform } from "../api";
import type { Detail } from "../types";
import { useStore } from "../store";
import { Empty, Img, Modal } from "../components/ui";
import { MediaCard } from "../components/cards";
import { useContentPreferences } from "../contentPreferences";
import { CollectionLink, CollectionLinks } from "../components/CollectionLink";
import { IChevR, IClock, IHeart, ILogout, ISettings, IStar, IUser, IUserF } from "../icons";

/* Account changes discard cached details synchronously, before another account can paint. */
export default function Profile({ wide }: { wide: boolean }) {
  const { accountScope } = useStore();
  return <ProfileContent key={accountScope} wide={wide} />;
}

function ProfileContent({ wide }: { wide: boolean }) {
  const { blockReason } = useContentPreferences();
  const { user, setLoginOpen, logout, history, favs, clearHistory, push, accountSync, syncAccount } = useStore();
  const [tab, setTab] = useState<"fav" | "history">("fav");
  const [cache, setCache] = useState<Record<number, Detail>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [limits, setLimits] = useState({ fav: 12, history: 12 });
  const [failedIds, setFailedIds] = useState<number[]>([]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutPending = useRef(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState("");
  const clearing = useRef(false);
  const mounted = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const ids = tab === "fav" ? favs : history.map((h) => h.id);
  const visibleIds = ids.slice(0, limits[tab]);
  const cards = visibleIds.map(id => cache[id]).filter((card): card is Detail => !!card);
  const failed = failedIds.filter(id => visibleIds.includes(id));
  const idsKey = visibleIds.join(",");
  const favoriteStateUnknown = tab === "fav" && !!user && !accountSync.favoritesKnown && favs.length === 0;
  const favoriteSyncFailed = favoriteStateUnknown && !accountSync.busy;
  const syncingFavorites = favoriteStateUnknown && !favoriteSyncFailed;
  /** 观看记录里这条的进度（收藏页没有） */
  const progressOf = (id: number) => (tab === "history" ? history.find((h) => h.id === id) : undefined);

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
        const failed: number[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") loaded[missing[index]] = result.value;
          else failed.push(missing[index]);
        });
        setCache(previous => ({ ...previous, ...loaded }));
        setFailedIds(failed);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [idsKey, tab, reload]);

  /* 菜单里的观看历史/收藏：切到对应分栏并把列表滚进视野（不再另开一页，数据都在本页） */
  const openSection = (next: "fav" | "history") => {
    setTab(next);
    contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
      {/* 顶栏 2 层（v3.top_bar S4）：状态栏 → 资料头一行（头像 52 + 昵称/ID + 右齿轮 22） */}
      <h1 className="sr-only">我的</h1>

      <div className="ios-page-body flex-1 scroll-y hg-page-x relative z-10"
        style={{ paddingBottom: "calc(59.6px + 32.2px + 12px + var(--sab, 0px))" }}>
        {/* 身份区（v3 S4：头像 52 + 昵称/ID + 右齿轮 22，一行）*/}
        <div className="hg-profile-head a-rise">
          {user ? (
            <>
              <span className="hg-profile-avatar">
                {user.avatar ? <Img src={user.avatar} eager /> : (user.nickname || "我").trim().charAt(0)}
              </span>
              <span className="hg-profile-meta">
                <span className="hg-profile-name">{user.nickname}</span>
                <span className="hg-profile-sub"><span className="whitespace-nowrap">@{user.username} · ID {user.id}</span></span>
              </span>
            </>
          ) : (
            <Button card className="hg-profile-guest" aria-label="未登录，登录后同步收藏与观看记录"
              onClick={() => setLoginOpen(true)}>
              <span className="hg-profile-avatar is-guest"><IUser size={22} /></span>
              <span className="hg-profile-meta">
                <span className="hg-profile-name">未登录</span>
                <span className="hg-profile-sub">登录后同步收藏与观看记录</span>
              </span>
              <span className="hg-profile-login">登录<IChevR size={13} /></span>
            </Button>
          )}
          <Button card className="hg-icon-plain" aria-label="打开设置"
            onClick={() => push({ kind: "settings" })}><ISettings size={22} strokeWidth={1.7} /></Button>
        </div>

        {user && accountSync.error && <div role="alert" className="mt-3 rounded-(--r-sm) bg-s3 p-3 text-[13px]">
          <p className="text-danger break-words">{accountSync.error}</p>
          <Button disabled={accountSync.busy} onClick={() => { void syncAccount().catch(() => {}); }}
            className="mt-1 min-h-11 px-3 text-on">{accountSync.busy ? "正在重试…" : "重试同步"}</Button>
        </div>}

        {/* 菜单：全部指向已有页面，不画没有接口的入口 */}
        <div className="hg-menu">
          <Button className="hg-menu-row" aria-label={`观看历史，${history.length} 条`} onClick={() => openSection("history")}>
            <span className="hg-menu-icon"><IClock size={16} /></span>
            <span className="hg-menu-label">观看历史</span>
            <span className="hg-menu-meta">{history.length}</span>
            <IChevR size={13} />
          </Button>
          <Button className="hg-menu-row" aria-label={`我的收藏，${favs.length} 部`} onClick={() => openSection("fav")}>
            <span className="hg-menu-icon"><IStar size={16} /></span>
            <span className="hg-menu-label">我的收藏</span>
            <span className="hg-menu-meta">{favs.length}</span>
            <IChevR size={13} />
          </Button>
          <Button className="hg-menu-row" onClick={() => push({ kind: "settings" })}>
            <span className="hg-menu-icon"><ISettings size={16} /></span>
            <span className="hg-menu-label">设置</span>
            <IChevR size={13} />
          </Button>
          {user && (
            <Button className="hg-menu-row" onClick={() => { setLogoutError(""); setLogoutOpen(true); }}>
              <span className="hg-menu-icon"><ILogout size={16} /></span>
              <span className="hg-menu-label">退出登录</span>
              <IChevR size={13} />
            </Button>
          )}
        </div>

        {/* 关注 / 我的主页 */}
        {user && (
          <CollectionLinks className="ios-profile-links mt-4">
            <CollectionLink icon={<IHeart size={18} />} title="我的关注" subtitle="关注作者的更新"
              onClick={() => push({ kind: "following" })} />
            <CollectionLink icon={<IUserF size={18} />} title="我的主页" subtitle="我的作品与资料"
              onClick={() => push({ kind: "user", id: user.id, name: user.nickname })} />
          </CollectionLinks>
        )}

        {/* 我的内容 */}
        <div ref={contentRef}>
        <SegmentedControl className="mt-4" aria-label="我的内容" activeIndex={tab === "fav" ? 0 : 1}>
          {([["fav", "我的收藏"], ["history", "观看历史"]] as const).map(([k, l]) => (
            <Button aria-pressed={tab === k} key={k} onClick={() => setTab(k)}>{l}</Button>
          ))}
        </SegmentedControl>
        </div>

        <div className="mt-3" aria-busy={loading || syncingFavorites}>
          {favoriteSyncFailed ? (
            <Empty icon={<IStar size={24} />} title="收藏状态未知"
              sub="账号同步未完成，暂时无法确认收藏内容。" action="重试"
              onAction={() => { void syncAccount().catch(() => {}); }} />
          ) : syncingFavorites ? (
            <FavoriteSyncState wide={wide} />
          ) : loading && !cards.length ? (
            <div className="flex justify-center py-8"><Loader className="w-7 h-7 spinner" /></div>
          ) : cards.length ? (
            <div className={`ios-media-grid ${wide ? "is-wide" : ""}`}>
              {cards.map((c) => {
                const progress = progressOf(c.id);
                return <MediaCard key={c.id} blockedReason={blockReason(c.tags)} title={c.title} cover={c.cover} score={c.score}
                  badge={c.is_finished ? "已完结" : `${c.episode_count} 集`}
                  subtitle={c.tags?.slice(0, 2).join(" · ")}
                  progress={progress ? `第 ${progress.ep} 集 · ${fmtTime(progress.t)}` : undefined}
                  onOpen={() => push({
                    kind: "feed", videoIds: cards.map(x => x.id), index: cards.findIndex(x => x.id === c.id),
                    title: tab === "fav" ? "我的收藏" : "观看历史", startEp: progress?.ep, startTime: progress?.t,
                  })} />;
              })}
            </div>
          ) : failed.length ? (
            <Empty icon={tab === "fav" ? <IStar size={24} /> : <IClock size={24} />}
              title={tab === "fav" ? "收藏加载失败" : "观看记录加载失败"}
              sub="记录仍在，重试后继续浏览。" action="重试" onAction={() => setReload(n => n + 1)} />
          ) : (
            <Empty icon={tab === "fav" ? <IStar size={24} /> : <IClock size={24} />}
              title={tab === "fav" ? "还没有收藏" : "还没有观看记录"}
              sub={tab === "fav" ? "在剧集页点收藏，之后就能在这里找到" : "看过的剧集会出现在这里"}
              action="去逛逛" onAction={() => push({ kind: "ranks" })} />
          )}
          {cards.length > 0 && failed.length > 0 && <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-mut">
            <span>{failed.length} 项内容加载失败，已加载内容仍可浏览。</span>
            <Button disabled={loading} onClick={() => setReload(n => n + 1)} className="px-3 text-primary">重试失败内容</Button>
          </div>}
          {cards.length > 0 && loading && <div className="flex justify-center py-3"><Loader label="加载更多内容" /></div>}
          {ids.length > 0 && <p role="status" className="mt-3 text-[12px] text-mut">已显示 {cards.length} / {ids.length} 项{user ? "账号记录" : "本机记录"}</p>}
          {visibleIds.length < ids.length && <Button disabled={loading} onClick={() => setLimits(previous => ({ ...previous, [tab]: previous[tab] + 12 }))}
            className="mt-3 w-full rounded-(--r-ctl) bg-s3 text-[13px] text-on">加载更多</Button>}
          {tab === "history" && history.length > 0 && (
            <Button disabled={clearBusy} aria-busy={clearBusy} onClick={() => { setClearError(""); setClearOpen(true); }} className="mt-3 w-full h-9 rounded-(--r-ctl) bg-s3 text-[13px] text-mut pressable">{clearBusy ? "正在清空…" : "清空观看历史"}</Button>
          )}
          {clearError && !clearOpen && <p role="alert" className="mt-2 text-[13px] text-danger">{clearError}</p>}
        </div>

        <div className="text-center text-[12px] text-dim mt-5">HGuoX {APP_VERSION} · {platform === "android" ? "Android" : platform === "ios" ? "iOS" : platform === "macos" ? "macOS" : platform === "linux" ? "Linux" : "Windows"} 客户端</div>
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
