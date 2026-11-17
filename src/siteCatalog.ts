/**
 * 站点配置（题材 / 排序 / 导航）的唯一入口。
 *
 * 三份清单都是服务端下发的，客户端不再写死：题材广场多出 AI魔改 / AI换脸 这类
 * 新内容时不需要改代码。规则：
 * - 内存缓存 10 分钟，命中就直接用，切页不重复请求；
 * - 请求失败或返回空，回落内置默认列表（就是过去写死的那几项），页面不白屏；
 * - 失败不写缓存，下次进入会重试。
 */
import { api } from "./api";
import type { SiteItem, SiteMenuItem } from "./types";

const TTL = 10 * 60 * 1000;

type Cached<T> = { at: number; value: T };

/** 题材卡片的展示形态：route 给接口，name 给标题，desc 是可选的副文案。 */
export type ChannelEntry = { cate: string; name: string; desc: string };

const FALLBACK_CHANNELS: ChannelEntry[] = [
  { cate: "ai-duanju", name: "AI成人短剧", desc: "高能反转 · 一口气看完" },
  { cate: "ai-manju", name: "AI成人漫剧", desc: "国创漫剧 · 每周更新" },
  { cate: "original", name: "原创", desc: "原创 · 独家好剧" },
];

const FALLBACK_SORTS: ChannelEntry[] = [
  { cate: "new", name: "最近更新", desc: "" },
  { cate: "popular", name: "当前最热", desc: "" },
  { cate: "watchings", name: "正在播放", desc: "" },
  { cate: "xiaolan", name: "小蓝原创", desc: "" },
];

const DESC: Record<string, string> = {
  "ai-mogai": "AI 魔改 · 换脸换命",
  "ai-huanlian": "AI 换脸 · 熟脸新剧",
  "ai-manju": "国创漫剧 · 每周更新",
  "ai-duanju": "高能反转 · 一口气看完",
};

let channelsCache: Cached<ChannelEntry[]> | null = null;
let sortsCache: Cached<ChannelEntry[]> | null = null;
let menusCache: Cached<SiteMenuItem[]> | null = null;

function fresh<T>(cache: Cached<T> | null): T | null {
  if (!cache) return null;
  return Date.now() - cache.at < TTL ? cache.value : null;
}

/** 服务端可能少字段或多字段：只认 name + route，缺就整条丢掉，别让页面崩。 */
function toItems(raw: unknown): SiteItem[] {
  const list = (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is SiteItem => {
    const row = item as Partial<SiteItem>;
    return !!row && typeof row.name === "string" && row.name.trim() !== ""
      && typeof row.route === "string" && row.route.trim() !== "";
  });
}

function byOrder<T extends { sort?: number; index?: number }>(a: T, b: T): number {
  const s = (a.sort ?? 0) - (b.sort ?? 0);
  return s !== 0 ? s : (a.index ?? 0) - (b.index ?? 0);
}

export async function siteChannels(): Promise<ChannelEntry[]> {
  const hit = fresh(channelsCache);
  if (hit) return hit;
  try {
    const items = toItems(await api.siteCategories());
    if (!items.length) throw new Error("empty");
    const value = items.sort(byOrder).map(item => ({
      cate: item.route,
      name: item.name,
      desc: item.intro?.trim() || DESC[item.route] || "每周持续上新",
    }));
    channelsCache = { at: Date.now(), value };
    return value;
  } catch {
    return FALLBACK_CHANNELS;
  }
}

export async function siteSorts(): Promise<ChannelEntry[]> {
  const hit = fresh(sortsCache);
  if (hit) return hit;
  try {
    const items = toItems(await api.siteSorts());
    if (!items.length) throw new Error("empty");
    const value = items.map(item => ({ cate: item.route, name: item.name, desc: "" }));
    sortsCache = { at: Date.now(), value };
    return value;
  } catch {
    return FALLBACK_SORTS;
  }
}

/** 导航只取「长视频 / 博客」两个入口，不追求 1:1 复刻站点结构。 */
export async function siteMenus(): Promise<SiteMenuItem[]> {
  const hit = fresh(menusCache);
  if (hit) return hit;
  try {
    const raw = (await api.siteMenus())?.category;
    const value = Array.isArray(raw) ? raw.filter(item => item && typeof item.name === "string") : [];
    if (!value.length) throw new Error("empty");
    menusCache = { at: Date.now(), value };
    return value;
  } catch {
    return [];
  }
}

/** 长视频入口的菜单项（没拿到就返回 null，由调用方决定隐藏还是用默认文案）。 */
export async function siteLongEntry(): Promise<SiteMenuItem | null> {
  const items = await siteMenus();
  return items.find(item => item.cat_code === "long" || item.name.includes("长视频")) ?? null;
}

export { FALLBACK_CHANNELS, FALLBACK_SORTS };
