#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify-screen-diff.py —— 逐屏「几何 + 差分」，可重跑。

    python3 scripts/verify-screen-diff.py --screen s2          # 分类
    python3 scripts/verify-screen-diff.py --screen all         # 四屏全跑

每屏输出到 /opt/data/hguox-redesign/验收-<屏>/：
    01-并排.png            参考 | 真机（同宽 720）
    02-几何.md / .json     模块带边界 + 元素块 bbox（自动，不手标）
    03-<带>-heatmap.png    偏差热区
    report.md              人看的总报告

参考：`/opt/data/images/upload_xu7ram94.jpeg` 按屏裁（坐标见 SCREENS）。
真机：小米9，dpr3 → 降到 720 宽（= 360 CSS × dpr2），与参考同尺度。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from collections import deque
from datetime import datetime

from PIL import Image, ImageFilter

W = 720
REF_IMG = "/opt/data/images/upload_xu7ram94.jpeg"
SERIAL = "192.168.31.106:5555"
OUT_ROOT = "/opt/data/hguox-redesign"

# 参考裁切框（x, y, w, h，原图 px）+ 真机操作
SCREENS = {
    "s2": dict(title="分类", crop=(410, 301, 302, 653), tap=(680, 2190), tab="分类"),
    "s3": dict(title="榜单", crop=(729, 301, 302, 647), tap=(750, 195), tab="榜单"),
    "s4": dict(title="我的", crop=(1049, 302, 302, 653), tap=(950, 2190), tab="我的"),
    "s7": dict(title="社区", crop=(729, 1000, 302, 653), tap=(410, 2190), tab="吃瓜"),
}

VAR_FLOOR = 5.0


# ---------------------------------------------------------------- 取图

def adb(args: str) -> str:
    cmd = (f'export PATH=$PREFIX/bin:$PATH; adb -s {SERIAL} {args}')
    r = subprocess.run(["ssh", "-o", "ConnectTimeout=15", "projbox", cmd],
                       capture_output=True, text=True)
    return r.stdout


def capture(screen: str) -> str:
    """锁竖屏 → force-stop 重启 → 等首屏 → 切到目标 tab → 截图。"""
    tmp = tempfile.mkdtemp(prefix="scr-diff-")
    local = os.path.join(tmp, f"{screen}.png")
    remote = "$HOME/_scr.png"
    tx, ty = SCREENS[screen]["tap"]
    script = (
        "export PATH=$PREFIX/bin:$PATH; "
        f"adb -s {SERIAL} shell 'settings put system accelerometer_rotation 0; "
        "settings put system user_rotation 0'; "
        f"adb -s {SERIAL} shell input keyevent 224; "
        f"adb -s {SERIAL} shell am force-stop com.hguox.app; sleep 1; "
        f"adb -s {SERIAL} shell am start -n com.hguox.app/.MainActivity >/dev/null; "
        "sleep 14; "
        f"adb -s {SERIAL} shell input tap {tx} {ty}; sleep 8; "
        f"adb -s {SERIAL} exec-out screencap -p > {remote}; ls -l {remote}"
    )
    prev = None
    for attempt in range(4):
        subprocess.run(["ssh", "-o", "ConnectTimeout=20", "projbox", script], check=True)
        with open(local, "wb") as f:
            subprocess.run(["ssh", "-o", "ConnectTimeout=20", "projbox", f"cat {remote}"],
                           check=True, stdout=f)
        if os.path.getsize(local) < 50_000:
            sys.exit(f"截图失败：{local}")
        im = Image.open(local).convert("L").resize((180, 390))
        cur = list(im.getdata())
        if prev is not None:
            diff = sum(1 for a, b in zip(prev, cur) if abs(a - b) > 6) / len(cur)
            if diff < 0.01:                       # 两帧一致 = 加载完了
                print(f"  截图稳定（第 {attempt + 1} 次，帧差 {diff:.1%}）")
                return local
            print(f"  还在变（帧差 {diff:.1%}），再等…")
        prev = cur
        script = script.replace("sleep 8;", "sleep 5;")
    return local


# ---------------------------------------------------------------- 基础测量

def to720(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    return im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)


def row_edges(im, x0=40, x1=680, step=2):
    px = im.load()
    out = []
    for y in range(3, im.height):
        s = 0
        for x in range(x0, x1, step):
            a, b = px[x, y], px[x, y - 3]
            s += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
        out.append((s, y))
    return out


def col_edges(im, y0, y1, x0=0, x1=W, step=2):
    px = im.load()
    out = []
    for x in range(max(3, x0), min(im.width, x1)):
        s = 0
        for y in range(y0, y1, step):
            a, b = px[x, y], px[x - 3, y]
            s += abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])
        out.append((s, x))
    return out


def band_edges(im, top=10):
    """行梯度剖面的强峰 = 模块的上下沿（按强弱取前 top 个，间距 ≥ 14 px）。"""
    prof = row_edges(im)
    prof.sort(reverse=True)
    picked = []
    for s, y in prof:
        if all(abs(y - p) >= 14 for _, p in picked):
            picked.append((s, y))
        if len(picked) >= top:
            break
    return sorted(y for _, y in picked)


def row_var(im, y, x0=40, x1=680, step=4):
    px = im.load()
    vals = [0.299 * px[x, y][0] + 0.587 * px[x, y][1] + 0.114 * px[x, y][2]
            for x in range(x0, x1, step)]
    m = sum(vals) / len(vals)
    return (sum((q - m) ** 2 for q in vals) / len(vals)) ** 0.5


def blocks(im, thr=10, blur=40, close=5, min_area=1200):
    """高反差（图 − 大半径模糊）→ 连通域 → 元素块。返回 CSS bbox。"""
    b = im.filter(ImageFilter.GaussianBlur(blur))
    px, bp = im.load(), b.load()
    Wd, H = im.size
    m = Image.new("L", (Wd, H), 0)
    mp = m.load()
    for y in range(H):
        for x in range(Wd):
            c, d = px[x, y], bp[x, y]
            if max(abs(c[0] - d[0]), abs(c[1] - d[1]), abs(c[2] - d[2])) > thr:
                mp[x, y] = 255
    m = m.filter(ImageFilter.MaxFilter(close))
    mp = m.load()
    seen = bytearray(Wd * H)
    out = []
    for sy in range(0, H, 2):
        for sx in range(0, Wd, 2):
            i = sy * Wd + sx
            if seen[i] or not mp[sx, sy]:
                continue
            q = deque([(sx, sy)])
            seen[i] = 1
            n = 0
            x0 = x1 = sx
            y0 = y1 = sy
            while q:
                x, y = q.popleft()
                n += 1
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                for nx, ny in ((x + 2, y), (x - 2, y), (x, y + 2), (x, y - 2)):
                    if 0 <= nx < Wd and 0 <= ny < H:
                        j = ny * Wd + nx
                        if not seen[j] and mp[nx, ny]:
                            seen[j] = 1
                            q.append((nx, ny))
            if n * 4 >= min_area:
                out.append(dict(x=round(x0 / 2, 1), y=round(y0 / 2, 1),
                                w=round((x1 - x0 + 1) / 2, 1), h=round((y1 - y0 + 1) / 2, 1),
                                a=n * 4))
    out.sort(key=lambda b: (b["y"], b["x"]))
    return out


def diff_region(ref, ours, box, dx=0, dy=0, tol_px=2, tol_rgb=8):
    x0, y0, x1, y1 = box
    r = ref.crop(box)
    o = ours.crop((x0 + dx, y0 + dy, x1 + dx, y1 + dy))
    rp, op = r.load(), o.load()
    m = Image.new("L", r.size, 0)
    mp = m.load()
    for y in range(r.height):
        for x in range(r.width):
            a, b = rp[x, y], op[x, y]
            if max(abs(a[i] - b[i]) for i in range(3)) > tol_rgb:
                mp[x, y] = 255
    m = m.filter(ImageFilter.MinFilter(2 * tol_px + 1))
    return m, r, o


# ---------------------------------------------------------------- 单屏

def run_screen(key: str, shot_path: str | None, reuse: bool = False) -> dict:
    cfg = SCREENS[key]
    out = os.path.join(OUT_ROOT, f"验收-{cfg['title']}")
    os.makedirs(out, exist_ok=True)

    ref = Image.open(REF_IMG).convert("RGB")
    x, y, w, h = cfg["crop"]
    ref = to720(ref.crop((x, y, x + w, y + h)))

    cached = os.path.join(out, "shot.png")
    if shot_path is None and reuse and os.path.exists(cached):
        shot_path = cached
    shot_path = shot_path or capture(key)
    shot = Image.open(shot_path).convert("RGB")
    ours = to720(shot)
    ours.save(os.path.join(out, "shot.png"))

    H = min(ref.height, ours.height)
    ref, ours = ref.crop((0, 0, W, H)), ours.crop((0, 0, W, H))

    # 1) 并排
    c = Image.new("RGB", (W * 2 + 16, H + 34), (14, 14, 18))
    c.paste(ref, (0, 34))
    c.paste(ours, (W + 16, 34))
    from PIL import ImageDraw
    d = ImageDraw.Draw(c)
    d.text((8, 12), f"参考 S{key[1]} · {cfg['title']}", fill=(255, 255, 255))
    d.text((W + 24, 12), "我们（小米9 真机）", fill=(255, 255, 255))
    c.save(os.path.join(out, "01-并排.png"))

    # 2) 模块带边界（行梯度峰）
    er, eo = band_edges(ref), band_edges(ours)
    n = min(len(er), len(eo))
    band_rows = []
    for i in range(n):
        dy = round((eo[i] - er[i]) / 2, 1)
        band_rows.append(dict(i=i + 1, ref=round(er[i] / 2, 1), ours=round(eo[i] / 2, 1), dy=dy))
    band_rows.sort(key=lambda r: -abs(r["dy"]))

    # 3) 模块带：相邻两条强边之间算一个模块，量它的 x 范围
    def modules(im):
        ys = band_edges(im, top=10)
        out = []
        for i in range(len(ys) - 1):
            y0, y1 = ys[i], ys[i + 1]
            if (y1 - y0) < 30:            # <15 CSS 的缝隙不算模块
                continue
            cols = col_edges(im, y0 + 4, y1 - 4)
            if cols:
                mx = max(v for v, _ in cols) or 1
                keep = [x for v, x in cols if v > mx * 0.30]
                x0, x1 = min(keep), max(keep)
            else:
                x0, x1 = 0, im.width
            out.append(dict(x=round(x0 / 2, 1), y=round(y0 / 2, 1),
                            w=round((x1 - x0 + 1) / 2, 1), h=round((y1 - y0 + 1) / 2, 1)))
        return out

    mr, mo = modules(ref), modules(ours)
    pairs = []
    for i in range(min(len(mr), len(mo))):
        a, b = mr[i], mo[i]
        pairs.append(dict(idx=i + 1, ref=a, ours=b,
                          dx=round(b["x"] - a["x"], 1), dy=round(b["y"] - a["y"], 1),
                          dw=round(b["w"] - a["w"], 1), dh=round(b["h"] - a["h"], 1)))
    for p in pairs:
        p["worst"] = max(abs(p["dx"]), abs(p["dy"]), abs(p["dw"]), abs(p["dh"]))
        p["verdict"] = "✓" if p["worst"] <= 1 else ("⚠" if p["worst"] <= 2 else "✗")
    pairs.sort(key=lambda p: -p["worst"])

    # 4) 四条水平带的热区
    bands = [("上", 0.00, 0.25), ("中上", 0.25, 0.50), ("中下", 0.50, 0.75), ("下", 0.75, 1.00)]
    heat = []
    for name, a, b in bands:
        box = (0, int(H * a), W, int(H * b))
        m, r, o = diff_region(ref, ours, box)
        red = m.histogram()[255]
        total = m.width * m.height
        base = o.point(lambda v: int(v * 0.45))
        hp = base.load()
        mp = m.load()
        for yy in range(m.height):
            for xx in range(m.width):
                if mp[xx, yy]:
                    hp[xx, yy] = (255, 40, 40)
        out_img = Image.new("RGB", (m.width * 2 + 12, m.height * 2), (12, 12, 16))
        out_img.paste(r.resize((m.width * 2, m.height * 2), Image.NEAREST), (0, 0))
        out_img.paste(base.resize((m.width * 2, m.height * 2), Image.NEAREST), (m.width * 2 + 12, 0))
        out_img.save(os.path.join(out, f"03-{name}-heatmap.png"))
        heat.append(dict(band=name, red=red, total=total, ratio=round(red / total * 100, 2)))

    ratios = sorted(h["ratio"] for h in heat)
    med_ratio = ratios[len(ratios) // 2]
    comparable = med_ratio < 60

    # 5) 报告
    md = [f"# S{key[1]} {cfg['title']} —— 几何 + 差分", "",
          f"- 参考：`{REF_IMG}` 裁 {cfg['crop']} → {W}px",
          f"- 真机：`{shot_path}`（副本 shot.png）", "",
          "## 一、模块几何（CSS；Δ = 我们 − 参考；≤1 ✓ / 1–2 ⚠ / >2 ✗）", "",
          "模块 = 相邻两条强水平边之间的一段（卡片/区块），按自上而下顺序配对。", "",
          "| # | 参考 x,y,w,h | 我们 x,y,w,h | Δx | Δy | Δw | Δh | 判定 |",
          "|---|---|---|---|---|---|---|---|"]
    for p in pairs[:14]:
        a, b = p["ref"], p["ours"]
        i = p["idx"]
        f = lambda v: f"{v:+g}"
        md.append(f'| {i} | {a["x"]},{a["y"]},{a["w"]},{a["h"]} | {b["x"]},{b["y"]},{b["w"]},{b["h"]} | '
                  f'{f(p["dx"])} | {f(p["dy"])} | {f(p["dw"])} | {f(p["dh"])} | {p["verdict"]} |')
    if not comparable:
        md = [x for x in md if not x.startswith("| ")]
        md += ["", f"> **这一屏和我们不是同一套结构**：四个水平带的偏差像素中位数 **{med_ratio:.0f}%**。",
               "> 模块不是「差几个像素」，而是整屏内容/配色都不同（参考有 VIP/金币/统计栏，我们没有；",
               "> 我们的「我的」还是浅色主题）。这种情况下逐项 Δ 没有意义，先定设计再谈还原。",
               "> 下面只保留并排图与偏差占比，几何表不输出。", ""]

    md += ["", "## 二、模块带边界（行梯度峰，CSS）", "", "| # | 参考 y | 我们 y | Δy |", "|---|---|---|---|"]
    for r in band_rows:
        md.append(f'| {r["i"]} | {r["ref"]} | {r["ours"]} | {r["dy"]:+g} |')
    md += ["", "## 三、偏差像素（ΔRGB>8，位置容差 1 CSS）", "", "| 带 | 偏差像素 | 占比 |", "|---|---|---|"]
    for hh in heat:
        md.append(f'| {hh["band"]} | {hh["red"]} | {hh["ratio"]}% |')
    open(os.path.join(out, "report.md"), "w").write("\n".join(md))
    json.dump(dict(screen=key, title=cfg["title"], shot=shot_path,
                   pairs=pairs[:12], bands=band_rows, heat=heat),
              open(os.path.join(out, "02-几何.json"), "w"), ensure_ascii=False, indent=1)

    print(f"S{key[1]} {cfg['title']}: 模块 {len(pairs)} 段，最大偏差 "
          f"{pairs[0]['worst'] if pairs else 0:g} CSS，红像素 "
          f"{sum(h['red'] for h in heat)}")
    return dict(screen=key, title=cfg["title"], out=out, pairs=pairs, bands=band_rows,
                heat=heat, comparable=comparable, med_ratio=med_ratio)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--screen", default="all", help="s2|s3|s4|s7|all")
    ap.add_argument("--shot", help="用现成截图（只对单屏有效）")
    ap.add_argument("--reuse", action="store_true", help="复用各屏目录里已有的 shot.png，不重新拍")
    a = ap.parse_args()
    keys = list(SCREENS) if a.screen == "all" else [a.screen]
    res = []
    for k in keys:
        if k not in SCREENS:
            sys.exit(f"未知屏：{k}")
        res.append(run_screen(k, a.shot if len(keys) == 1 else None, a.reuse))
        time.sleep(1)

    # 总表
    md = [f"# 验收总表 {datetime.now():%Y-%m-%d %H:%M}", "",
          "| 屏 | 模块数 | 最大偏差 CSS | top3 偏差项 | 达 Δ≤1 |", "|---|---|---|---|---|"]
    for r in res:
        top = "；".join(
            f'模块{p["idx"]} y{p["ref"]["y"]}→Δy{p["dy"]:+g}/Δh{p["dh"]:+g}'
            for p in r["pairs"][:3]) or "—"
        ok = "是" if (r.get("comparable", True) and r["pairs"]
                      and all(p["worst"] <= 1 for p in r["pairs"])) else "否"
        if not r.get("comparable", True):
            md.append(f'| S{r["screen"][1]} {r["title"]} | — | — | 结构不同（偏差中位 '
                      f'{r["med_ratio"]:.0f}%），几何不可比 | 否 |')
        else:
            md.append(f'| S{r["screen"][1]} {r["title"]} | {len(r["pairs"])} | '
                      f'{r["pairs"][0]["worst"] if r["pairs"] else 0:g} | {top} | {ok} |')
    md += ["", "明细见各屏目录的 `report.md` 与 `01-并排.png`。"]
    open(os.path.join(OUT_ROOT, "验收-总表.md"), "w").write("\n".join(md))
    print(f"\n总表：{OUT_ROOT}/验收-总表.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
