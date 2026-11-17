#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""verify-home-diff.py —— 首页「逐区域差分」，可重跑。

参考设计稿的 S1 首页 与 真机截图 缩放到同一坐标系（宽 720 px = dpr2 下的 360 CSS），
按区域做像素差分，每区域独立对齐后统计红区，输出 heatmap 和排序表。

判定：位置差 > tol_css 或 ΔRGB > tol_rgb 记为红。
     位置容差用「腐蚀」实现：红像素必须在 (2t+1)² 方块内全部超阈值才算，
     1 CSS px 的错位不会误报，真正的尺寸/颜色差照样留下。

每个区域单独搜一次最佳位移，所以「本区还需要移动多少」本身就是一条结论：
     dy ≠ 0 说明这一块在页面上的高度与参考不一致（间距/模块高度的问题）。

红区按成因分三类（自动分类，不猜）：
     素材 = 大块高方差区域（封面照片）——两边的剧不同，永远红，不参与判定
     文字 = 小块高方差区域（字形）——中英文案不同，不参与判定
     结构 = 其余（底色/描边/圆角/间距/控件尺寸）——**这一类必须降到 0**

用法：
    python3 scripts/verify-home-diff.py                  # 现拍真机 + 参考
    python3 scripts/verify-home-diff.py --shot a.png     # 用已有截图（1080 宽）
    python3 scripts/verify-home-diff.py --out /tmp/x --tol-css 1 --tol-rgb 8

依赖：PIL（不需要 numpy）；拍图需要 `ssh projbox` + adb（小米9 常开盒子）。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import deque
from datetime import datetime

from PIL import Image, ImageFilter

# ---------------------------------------------------------------- 常量

REF_DEFAULT = "/opt/data/images/upload_xu7ram94.jpeg"
S1_CROP = (90, 302, 302, 653)      # 参考大图里 S1（首页）的裁切框：x0,y0,w,h（图 px）

OUT_W = 720                        # 统一宽度 = 360 CSS × dpr2
TOL_CSS = 1.0
TOL_RGB = 8
ACCENT = (139, 154, 249)           # 胶囊选中描边色，用作垂直锚点
STATUS_H_REF = 25                  # 参考图里系统状态栏高度（图 px），不参与判定

# name, y0, y1（参考图 px）, kind
REGIONS = [
    ("顶栏",        25,  74, "chrome"),
    ("胶囊tab行",   74, 101, "chrome"),
    ("Hero",       101, 345, "content"),
    ("分区标题行",  356, 392, "chrome"),
    ("货架",       392, 510, "content"),
    ("继续观看",    512, 574, "content"),
    ("底栏",       574, 640, "chrome"),
]

SEARCH_DY = 120   # 局部对齐搜索范围（720 坐标 px）
SEARCH_DX = 24


# ---------------------------------------------------------------- 取图

def capture_device() -> str:
    """锁竖屏 → 起 App → 等首屏 → 截图（1080 宽）。"""
    tmp = tempfile.mkdtemp(prefix="home-diff-")
    local = os.path.join(tmp, "shot.png")
    remote = "$HOME/_diff_shot.png"
    script = (
        "export PATH=$PREFIX/bin:$PATH; "
        "adb -s 192.168.31.106:5555 shell 'settings put system accelerometer_rotation 0; "
        "settings put system user_rotation 0'; "
        "adb -s 192.168.31.106:5555 shell input keyevent 224; "
        "adb -s 192.168.31.106:5555 shell am start -n com.hguox.app/.MainActivity >/dev/null; "
        "sleep 8; "
        f"adb -s 192.168.31.106:5555 exec-out screencap -p > {remote}; ls -l {remote}"
    )
    subprocess.run(["ssh", "-o", "ConnectTimeout=15", "projbox", script], check=True)
    with open(local, "wb") as f:
        subprocess.run(["ssh", "-o", "ConnectTimeout=15", "projbox", f"cat {remote}"],
                       check=True, stdout=f)
    if os.path.getsize(local) < 50_000:
        sys.exit(f"截图失败或过小：{local}")
    return local


# ---------------------------------------------------------------- 对齐

def accent_top(im: Image.Image, y0: int, y1: int) -> int | None:
    px = im.load()
    for y in range(y0, y1):
        n = 0
        for x in range(0, im.width, 2):
            c = px[x, y]
            if all(abs(c[i] - ACCENT[i]) <= 55 for i in range(3)):
                n += 1
                if n > 6:
                    return y
    return None


def bar_top(im: Image.Image) -> int:
    px = im.load()
    W, H = im.size
    for y in range(H - 6, int(H * 0.6), -1):
        bright = sum(1 for x in range(W // 6, W * 5 // 6, 6)
                     if 0.299 * px[x, y][0] + 0.587 * px[x, y][1] + 0.114 * px[x, y][2] > 70)
        if bright < 40:
            return y + 1
    return H


def _mean_abs(ref: Image.Image, ours: Image.Image, box, dx: int, dy: int, step: int = 4) -> float:
    """区域内平均 |Δ|（步长采样），用于搜最佳位移。"""
    x0, y0, x1, y1 = box
    r = ref.crop(box).load()
    o = ours.load()
    W, H = ours.size
    s = 0
    n = 0
    for y in range(y0, y1, step):
        yy = y + dy
        if yy < 0 or yy >= H:
            s += 255 * step
            continue
        for x in range(x0, x1, step):
            xx = x + dx
            if xx < 0 or xx >= W:
                s += 255
                n += 1
                continue
            a, b = r[x - x0, y - y0], o[xx, yy]
            s += max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))
            n += 1
    return s / max(1, n)


def best_offset(ref, ours, box, base=(0, 0)):
    """粗搜 + 细化，返回 (dx, dy, 平均 |Δ|)。"""
    bdx, bdy = base
    best = (bdx, bdy, _mean_abs(ref, ours, box, bdx, bdy, step=6))
    for dy in range(bdy - SEARCH_DY, bdy + SEARCH_DY + 1, 6):
        for dx in range(bdx - SEARCH_DX, bdx + SEARCH_DX + 1, 6):
            v = _mean_abs(ref, ours, box, dx, dy, step=6)
            if v < best[2]:
                best = (dx, dy, v)
    dx0, dy0 = best[0], best[1]
    for dy in range(dy0 - 6, dy0 + 7, 2):
        for dx in range(dx0 - 6, dx0 + 7, 2):
            v = _mean_abs(ref, ours, box, dx, dy, step=2)
            if v < best[2]:
                best = (dx, dy, v)
    return best


# ---------------------------------------------------------------- 成因分类

def components(mask: Image.Image, thr_area: int, big_area: int):
    """把 0/255 mask 拆成 大块(素材) / 小块(文字) 两张 mask。"""
    W, H = mask.size
    mp = mask.load()
    seen = bytearray(W * H)
    big = Image.new("L", (W, H), 0)
    small = Image.new("L", (W, H), 0)
    bp, sp = big.load(), small.load()
    for sx in range(0, W, 2):
        for sy in range(0, H, 2):
            i = sy * W + sx
            if seen[i] or not mp[sx, sy]:
                continue
            q = deque([(sx, sy)])
            seen[i] = 1
            pts = []
            x0 = x1 = sx
            y0 = y1 = sy
            while q:
                x, y = q.popleft()
                pts.append((x, y))
                x0, x1 = min(x0, x), max(x1, x)
                y0, y1 = min(y0, y), max(y1, y)
                for nx, ny in ((x + 2, y), (x - 2, y), (x, y + 2), (x, y - 2)):
                    if 0 <= nx < W and 0 <= ny < H:
                        j = ny * W + nx
                        if not seen[j] and mp[nx, ny]:
                            seen[j] = 1
                            q.append((nx, ny))
            area = len(pts) * 4
            tall = (y1 - y0) > 48
            tgt = big if (area >= big_area or (tall and area >= thr_area)) else small
            tp = bp if tgt is big else sp
            for (x, y) in pts:
                for ox in (0, 1):
                    for oy in (0, 1):
                        if x + ox < W and y + oy < H:
                            tp[x + ox, y + oy] = 255
    big = big.filter(ImageFilter.MaxFilter(3))
    small = small.filter(ImageFilter.MaxFilter(3))
    return big, small


def variance_mask(im: Image.Image, block: int = 8, thr: float = 14.0) -> Image.Image:
    """高方差区（照片/字形）：8×8 块内亮度标准差 > thr。"""
    g = im.convert("L")
    W, H = g.size
    px = g.load()
    mw, mh = (W + block - 1) // block, (H + block - 1) // block
    m = Image.new("L", (mw, mh), 0)
    mp = m.load()
    for by in range(mh):
        for bx in range(mw):
            vals = [px[x, y]
                    for y in range(by * block, min((by + 1) * block, H))
                    for x in range(bx * block, min((bx + 1) * block, W))]
            if not vals:
                continue
            mean = sum(vals) / len(vals)
            if (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5 > thr:
                mp[bx, by] = 255
    return m.resize((W, H), Image.NEAREST)


# ---------------------------------------------------------------- 差分

def diff_mask(ref_crop: Image.Image, ours_crop: Image.Image, tol_rgb: int) -> Image.Image:
    W, H = ref_crop.size
    rp, op = ref_crop.load(), ours_crop.load()
    m = Image.new("L", (W, H), 0)
    mp = m.load()
    for y in range(H):
        for x in range(W):
            a, b = rp[x, y], op[x, y]
            if max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2])) > tol_rgb:
                mp[x, y] = 255
    return m


def count(mask: Image.Image) -> int:
    return mask.histogram()[255] if mask.mode == "L" else 0


def largest_block(mask: Image.Image, down: int = 2):
    m = mask.resize((max(1, mask.width // down), max(1, mask.height // down)), Image.NEAREST)
    W, H = m.size
    mp = m.load()
    seen = bytearray(W * H)
    best = (0, None)
    for sx in range(W):
        for sy in range(H):
            i = sy * W + sx
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
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < W and 0 <= ny < H:
                        j = ny * W + nx
                        if not seen[j] and mp[nx, ny]:
                            seen[j] = 1
                            q.append((nx, ny))
            if n > best[0]:
                best = (n, (x0 * down, y0 * down, (x1 - x0 + 1) * down, (y1 - y0 + 1) * down))
    return best


# ---------------------------------------------------------------- 主流程

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default=REF_DEFAULT)
    ap.add_argument("--shot")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "diff-home"))
    ap.add_argument("--tol-css", type=float, default=TOL_CSS)
    ap.add_argument("--tol-rgb", type=int, default=TOL_RGB)
    ap.add_argument("--no-capture", action="store_true")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)

    # 1) 参考：裁 S1 → 720 宽
    raw = Image.open(a.ref).convert("RGB")
    cx, cy, cw, ch = S1_CROP
    ref = raw.crop((cx, cy, cx + cw, cy + ch))
    s2 = OUT_W / ref.width
    ref = ref.resize((OUT_W, round(ref.height * s2)), Image.LANCZOS)

    # 2) 真机 → 720 宽
    shot_path = a.shot or (None if a.no_capture else capture_device())
    if not shot_path:
        sys.exit("没有截图：给 --shot 或去掉 --no-capture")
    shot = Image.open(shot_path).convert("RGB")
    ours = shot.resize((OUT_W, round(shot.height * OUT_W / shot.width)), Image.LANCZOS)
    H = min(ref.height, ours.height)
    ref, ours = ref.crop((0, 0, OUT_W, H)), ours.crop((0, 0, OUT_W, H))

    # 3) 全局锚点（只用来报「整体差多少」，每个区域还会各自对齐）
    t_ref = accent_top(ref, int(60 * s2), int(130 * s2)) or 0
    t_our = accent_top(ours, int(60 * s2), int(130 * s2)) or 0
    g_dy = t_our - t_ref
    g_dx = 0
    bar_res = (bar_top(ours) - g_dy) - bar_top(ref)

    print(f"全局锚点：胶囊 tab 行 ref y={t_ref} / ours y={t_our} → 整页下移 {g_dy}px"
          f"（{g_dy / 2:.1f} CSS）；底栏固定，残余 {bar_res}px（{bar_res / 2:.1f} CSS）")
    print(f"          底栏上沿 ref y={bar_top(ref)} / ours y={bar_top(ours)}\n")

    tol_px = max(1, round(a.tol_css * 2))
    rows = []
    for name, y0, y1, kind in REGIONS:
        box = (0, round(y0 * s2), OUT_W, round(y1 * s2))
        dx, dy, _ = best_offset(ref, ours, box)
        r = ref.crop(box)
        o = ours.crop((box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy))
        m = diff_mask(r, o, a.tol_rgb)
        if tol_px:
            m = m.filter(ImageFilter.MinFilter(2 * tol_px + 1))

        vm = variance_mask(r)
        big, small = components(vm, thr_area=400, big_area=2500)
        # 结构红 = 总红 − 素材红 − 文字红
        core = m.copy()
        cp, bp, sp = core.load(), big.load(), small.load()
        for y in range(core.height):
            for x in range(core.width):
                if cp[x, y] and (bp[x, y] or sp[x, y]):
                    cp[x, y] = 0
        red, red_core = count(m), count(core)
        red_mat = sum(1 for y in range(m.height) for x in range(m.width)
                      if m.getpixel((x, y)) and big.getpixel((x, y)))
        red_txt = sum(1 for y in range(m.height) for x in range(m.width)
                      if m.getpixel((x, y)) and small.getpixel((x, y)) and not big.getpixel((x, y)))
        blk = largest_block(core)

        # heatmap：左参考 / 右我们压暗 + 红区（深红=素材/文字，亮红=结构）
        base = o.point(lambda v: int(v * 0.4))
        hp = base.load()
        for y in range(m.height):
            for x in range(m.width):
                if m.getpixel((x, y)):
                    hp[x, y] = (255, 40, 40) if core.getpixel((x, y)) else (110, 30, 30)
        W2, H2 = m.width * 2, m.height * 2
        out = Image.new("RGB", (W2 * 2 + 12, H2), (12, 12, 16))
        out.paste(r.resize((W2, H2), Image.NEAREST), (0, 0))
        out.paste(base.resize((W2, H2), Image.NEAREST), (W2 + 12, 0))
        out.save(os.path.join(a.out, f"{name}-heatmap.png"))
        r.save(os.path.join(a.out, f"{name}-ref.png"))
        o.save(os.path.join(a.out, f"{name}-ours.png"))

        rows.append(dict(region=name, kind=kind, dx=dx, dy=dy, red=red, red_core=red_core,
                         red_mat=red_mat, red_txt=red_txt, total=m.width * m.height,
                         core_ratio=round(red_core / (m.width * m.height) * 100, 2),
                         block=blk[1], block_px=blk[0]))

    rows.sort(key=lambda r: r["red_core"], reverse=True)

    md = [f"# 首页差分报告 {datetime.now():%Y-%m-%d %H:%M}", "",
          f"- 参考：`{a.ref}` 裁 {S1_CROP} → {OUT_W}px",
          f"- 真机：`{shot_path}` → {OUT_W}px",
          f"- 阈值：位置 >{a.tol_css} CSS / ΔRGB>{a.tol_rgb}；每区域独立对齐",
          f"- 整页锚点：胶囊 tab 行 ours 比 ref 低 **{g_dy}px（{g_dy / 2:.1f} CSS）**；"
          f"底栏固定，残余 {bar_res}px（{bar_res / 2:.1f} CSS）", "",
          "| # | 区域 | 类型 | 本区位移 dx,dy | 结构红(必须=0) | 素材红 | 文字红 | 最大结构红块 |",
          "|---|---|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        b = f'{r["block"][2]}×{r["block"][3]}' if r["block"] else "—"
        md.append(f'| {i} | {r["region"]} | {r["kind"]} | {r["dx"]},{r["dy"]} | '
                  f'**{r["red_core"]}** | {r["red_mat"]} | {r["red_txt"]} | {b} |')
    md += ["", "> 结构红 = 底色/描边/圆角/间距/控件尺寸的差，这是要清零的。",
           "> 素材红、文字红来自「两边的剧和文案不同」，不参与判定。"]
    open(os.path.join(a.out, "report.md"), "w").write("\n".join(md))
    json.dump(dict(ref=a.ref, shot=shot_path, global_dy=g_dy, bar_residual=bar_res,
                   tol_css=a.tol_css, tol_rgb=a.tol_rgb, regions=rows),
              open(os.path.join(a.out, "report.json"), "w"), ensure_ascii=False, indent=1)

    print(f"{'区域':<9}{'类型':<8}{'位移':>9}{'结构红':>8}{'素材红':>8}{'文字红':>8}  最大结构红块")
    for r in rows:
        b = f'{r["block"][2]}×{r["block"][3]}' if r["block"] else "—"
        print(f'{r["region"]:<9}{r["kind"]:<8}{r["dx"]:>4},{r["dy"]:<4}{r["red_core"]:>8}'
              f'{r["red_mat"]:>8}{r["red_txt"]:>8}  {b}')
    print(f"\n图与报告：{a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
