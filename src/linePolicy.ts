/* 自动选线的「切 / 不切」判定。纯函数，无 IO，状态表见 docs/线路策略.md。
 *
 * 三条铁律：
 *  1. 用户手动摆上的线路是「偏好」，只要它还没被判定失败，自动选线不许把它换掉；
 *  2. 只有偏好线路「连续 2 次失败」后，才让位给后端选出的可用线路，并且要提示一次；
 *  3. 偏好线路恢复后自己回来，且**不提示**（用户本来就要这条，不算突发事件）。
 */

export type LineCandidate = { url: string; ok: boolean; reachable: boolean };

export type LinePlan = {
  /** 应该生效的线路（可能等于 current，表示不用动） */
  target: string;
  /** target ≠ current：需要改线路 */
  changed: boolean;
  /** 只有「偏好线路被判失败、被迫换线」这一次才提示 */
  notify: false | "preferred-down";
};

/** 可用 = 探活成功，或至少能连上（reachable 但接口 4xx 的镜像也算，交给业务层兜） */
const usable = (candidate: LineCandidate | undefined): boolean => !!candidate && (candidate.ok || candidate.reachable);

export function decideLine(input: {
  /** 当前生效线路 */
  current: string;
  /** 后端 line_auto 选出的最佳线路 */
  backendPick: string;
  /** 用户手动选过的线路，空串 = 没有偏好 */
  preferred: string;
  /** 后端这一轮的探活结果 */
  candidates: LineCandidate[];
  /** 偏好线路是否已「连续失败」（探活失败 ×2 或请求失败 ×2），或仍在避让窗口里 */
  preferredFailing?: boolean;
}): LinePlan {
  const { current, backendPick, preferred, candidates, preferredFailing = false } = input;
  const pref = preferred.trim();
  const prefCandidate = pref ? candidates.find((c) => c.url === pref) : undefined;
  /* 候选表里没有它（例如用户自定义镜像不在探活列表里）就先信任它，失败交给健康巡检计数 */
  const listed = candidates.length > 0;
  const prefKnownGood = !listed || prefCandidate === undefined || usable(prefCandidate);
  const keepPreferred = !!pref && !preferredFailing && prefKnownGood;
  const target = keepPreferred ? pref : (backendPick || current);
  const changed = !!target && target !== current;
  const notify: LinePlan["notify"] = changed && !keepPreferred && !!pref ? "preferred-down" : false;
  return { target, changed, notify };
}
