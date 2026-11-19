import { useEffect, useState } from "react";
import { api, hostOf, type LineItem } from "../api";
import { useStore } from "../store";
import { pauseAutoPick } from "../autoLine";
import { setPreferredLine } from "../linePreference";
import { Button } from "./ios/controls";
import { Sheet } from "./ui";
import { ICheck, IClose } from "../icons";

/**
 * 播放页就地切线路：只列线路、点一下即切换、切完自动收面板。
 * 不跳设置页、不暴露自定义地址与检测（那些留给「我的 · 网络与线路」）。
 * 入口由调用方自己决定渲不渲染（只有一条线路时不渲染）。
 */
export default function LineQuickSwitch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useStore();
  const [base, setBase] = useState("");
  const [fixed, setFixed] = useState<LineItem[]>([]);
  const [mirrors, setMirrors] = useState<LineItem[]>([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    api.lineState()
      .then(s => { if (alive) { setBase(s.base); setFixed(s.fixed || []); } })
      .catch(() => { /* 读不到就只显示镜像 */ });
    api.lineMirrors()
      .then(r => { if (alive) setMirrors(r?.items || []); })
      .catch(() => { if (alive) setMirrors([]); });
    return () => { alive = false; };
  }, [open]);

  const pick = async (url: string) => {
    if (busy) return;
    if (!url || url === base) { onClose(); return; }
    setBusy(url);
    try {
      /* 手动选线 = 本次优先：取消在途的自动选线，但保持自动选线开着（见 docs/线路策略.md） */
      await pauseAutoPick();
      const next = await api.lineSet(url);
      setPreferredLine(next);
      /* 登录态交给 boot 裁决：可信线路间后端 rebase 保留登录，自定义站点后端已清会话 */
      setBase(next);
      toast(`线路已切换到 ${hostOf(next)}，已设为优先线路；不可用时会自动切走`, "ok");
      window.dispatchEvent(new Event("hg:line-changed"));
      onClose();
    } catch (e) {
      toast((e as Error).message || "切换失败", "info");
    } finally {
      setBusy("");
    }
  };

  const seen = new Set<string>();
  const rows: { url: string; label: string }[] = [];
  for (const i of [...fixed, ...mirrors]) {
    if (!i?.url || seen.has(i.url)) continue;
    seen.add(i.url);
    rows.push({ url: i.url, label: i.name?.trim() || hostOf(i.url) });
  }

  return (
    <Sheet open={open} onClose={onClose} label="切换线路">
      <div className="flex flex-col" style={{ maxHeight: "60vh" }}>
        <div className="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-on leading-tight">切换线路</div>
            <div className="text-[12px] text-mut mt-0.5 truncate">当前：{base ? hostOf(base) : "读取中…"}</div>
          </div>
          <Button onClick={onClose} aria-label="关闭" className="w-9 h-9 rounded-full bg-s3/80 flex items-center justify-center text-mut pressable">
            <IClose size={16} />
          </Button>
        </div>
        <div className="flex-1 scroll-y px-3 pb-4">
          {!rows.length && <div className="text-center text-[12px] text-dim py-8">正在读取线路…</div>}
          {rows.map(item => {
            const current = item.url === base;
            return (
              <Button key={item.url} card onClick={() => void pick(item.url)} disabled={!!busy}
                className={`w-full flex items-center gap-2 px-3.5 py-3 rounded-(--r-md) mb-1.5 text-left pressable ${current ? "bg-s3/70" : "bg-s2"}`}>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] text-on truncate">{item.label}</span>
                  <span className="block text-[12px] text-mut truncate mt-0.5">{hostOf(item.url)}</span>
                </span>
                {busy === item.url ? <span className="text-[12px] text-mut shrink-0">切换中…</span>
                  : current ? <ICheck size={15} className="text-mint shrink-0" /> : null}
              </Button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
