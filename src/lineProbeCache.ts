/**
 * 线路探活结果缓存（**不新增请求**）。
 *
 * 自动选线每次都会拿回一批候选的探测结果（`pick.candidates`：ok / reachable / ms / status），
 * 线路面板直接读这份缓存显示延迟；没探过的显示「未测」，绝不编数字。
 */
export type ProbeEntry = { ok: boolean; reachable: boolean; ms: number; status: number | null };

const probes = new Map<string, ProbeEntry>();

/** 探活结果的归一化 key：只留 host（同一台镜像的尾斜杠/大小写差异不该算两条） */
export function probeKey(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
}

/** 自动选线跑完记一笔（覆盖旧值，后来的结果更新） */
export function recordProbes(
  list: { url: string; ok: boolean; reachable: boolean; ms: number; status: number | null }[] | undefined,
): void {
  if (!list?.length) return;
  for (const item of list) {
    const key = probeKey(item.url);
    if (!key) continue;
    probes.set(key, { ok: !!item.ok, reachable: !!item.reachable, ms: Number(item.ms) || 0, status: item.status ?? null });
  }
}

/** 读一条探活结果；没探过返回 null（面板显示「未测」） */
export function readProbe(url: string): ProbeEntry | null {
  return probes.get(probeKey(url)) ?? null;
}

/**
 * 分组：同一域名族（后两段）算一组，例如 a.zuxszoix.cc / b.zuxszoix.cc → zuxszoix.cc。
 * 面板因此把 39 行折成 2–3 组。
 */
export function domainFamily(url: string): string {
  const key = probeKey(url);
  if (!key) return "其他";
  const parts = key.split(".");
  if (parts.length <= 2) return key;
  return parts.slice(-2).join(".");
}
