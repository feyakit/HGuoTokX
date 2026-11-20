/**
 * 详情首屏加速（低风险包装层，不动数据层）：
 *
 * 1. **预取**：列表页拿到首屏卡片后，对前几张并发预取详情（并发 2，只取 JSON，失败静默）。
 * 2. **慢线路并行**：详情请求超过 3s 没回，就并行用一次现有自动选线（复用候选/自定义镜像），
 *    再发一次同样的详情请求，谁先成功用谁。**不改**用户保存的线路偏好（自动选线自己有偏好策略）。
 *
 * 两件事都只包在 `api.video` 外面，Rust 侧与接口形状不变。
 */
import { api, logLine } from "./api";
import type { Detail } from "./types";

const CACHE_TTL_MS = 5 * 60_000;
const SLOW_MS = 3_000;
const PREFETCH_LIMIT = 4;
const PREFETCH_CONCURRENCY = 2;

type Entry = { at: number; data: Detail };
const cache = new Map<number, Entry>();
const inflight = new Map<number, Promise<Detail>>();

const fresh = (entry: Entry | undefined): entry is Entry =>
  !!entry && Date.now() - entry.at < CACHE_TTL_MS;

/** 已经预取到的详情（同步读，用来让详情页首帧直接出内容） */
export function cachedDetail(id: number): Detail | null {
  const entry = cache.get(id);
  return fresh(entry) ? entry.data : null;
}

function remember(id: number, data: Detail): Detail {
  cache.set(id, { at: Date.now(), data });
  return data;
}

/**
 * 一次详情请求：3s 内回来就直接用；超过 3s 就并行换一次线路再发一条，谁先成功用谁。
 * 失败仍然抛出，交给调用方显示错误（不吞错）。
 */
async function slowLaneRace(id: number, first: Promise<Detail>): Promise<Detail> {
  let timer = 0;
  const timeout = new Promise<"slow">((resolve) => {
    timer = window.setTimeout(() => resolve("slow"), SLOW_MS);
  });
  const settled = first.then(
    (data) => ({ kind: "ok" as const, data }),
    (error) => ({ kind: "err" as const, error }),
  );
  const winner = await Promise.race([settled, timeout]);
  window.clearTimeout(timer);
  if (winner !== "slow" && winner.kind === "ok") return winner.data;

  /* 慢（或第一条已经失败）：让自动选线用现有候选换一条更快线路，再发一次。
     两条并存，谁先成功算谁的；都失败时抛第一条的错误。 */
  logLine(`[detail] ${id} 超过 ${SLOW_MS}ms 未返回，并行换线重试`);
  void api.lineAuto().catch(() => {});
  const second = api.video(id);
  try {
    return await Promise.any([first, second]);
  } catch {
    if (winner !== "slow" && winner.kind === "err") throw winner.error;
    throw new Error("详情加载失败（快慢线路都没返回）");
  }
}

/** 详情请求的唯一入口（带缓存 + 去重 + 慢线路并行重试） */
export function loadDetail(id: number): Promise<Detail> {
  const hit = cachedDetail(id);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(id);
  if (running) return running;
  const task = slowLaneRace(id, api.video(id))
    .then((data) => remember(id, data))
    .finally(() => { inflight.delete(id); });
  inflight.set(id, task);
  return task;
}

/**
 * 预取详情：只取 JSON、不走慢线路重试、失败静默。
 * 并发固定 2，避免把首屏的数据请求挤掉。
 */
export function prefetchDetails(ids: number[], limit = PREFETCH_LIMIT): void {
  const queue = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
    .filter((id) => !cachedDetail(id) && !inflight.has(id))
    .slice(0, limit);
  if (!queue.length) return;
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const id = queue[cursor++];
      try {
        const data = await api.video(id);
        if (data) remember(id, data);
      } catch {
        /* 预取失败一律静默：用户点进去时还会再正常请求一次 */
      }
    }
  };
  for (let i = 0; i < Math.min(PREFETCH_CONCURRENCY, queue.length); i += 1) void worker();
}
