#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""home_geom.py —— 首页元素的几何测量（自动，不手标）。

原理：元素是「有边界、有内部纹理」的块，画布是「平滑渐变」。所以
  · 上下边  = 行梯度剖面在 ROI 里的最强峰（边界锐利处）
  · 下边兜底 = 行内方差掉回画布水平（<5）的第一行（封面底部压暗时梯度弱）
  · 左右边  = 列梯度剖面在块内的强峰（取最外两个）
  · 小件    = ROI 内亮块连通域（文字/图标/角标）
坐标一律 720 px 宽 = 360 CSS × dpr2，返回 CSS。
"""

from __future__ import annotations

from collections import deque

from PIL import Image

W = 720
VAR_FLOOR = 5.0     # 行方差低于此视为画布


def to720(im: Image.Image) -> Image.Image:
    im = im.convert("RGB")
    return im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)


def row_edges(im, y0, y1, x0=40, x1=680, step=2):
    px = im.load()
    out = []
    for y in range(max(3, y0), min(im.height, y1)):
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


def row_var(im, y, x0=40, x1=680, step=4):
    px = im.load()
    vals = [0.299 * px[x, y][0] + 0.587 * px[x, y][1] + 0.114 * px[x, y][2]
            for x in range(x0, x1, step)]
    m = sum(vals) / len(vals)
    return (sum((q - m) ** 2 for q in vals) / len(vals)) ** 0.5


def peak(prof, lo, hi):
    best = (0, None)
    for s, i in prof:
        if lo <= i <= hi and s > best[0]:
            best = (s, i)
    return best[1]


def block_bottom(im, y_start, limit=700):
    """从 y_start 往下，行方差掉回画布的第一行 = 块的下沿。"""
    for y in range(y_start + 20, min(im.height, y_start + limit)):
        if row_var(im, y) < VAR_FLOOR:
            return y
    return None


def strong_cols(im, y0, y1, frac=0.35):
    """块内列梯度的强峰（取相对最强的那批），返回排序后的 x 列表。"""
    prof = col_edges(im, y0, y1)
    if not prof:
        return []
    mx = max(s for s, _ in prof) or 1
    keep = [(s, x) for s, x in prof if s > mx * frac]
    xs = []
    for _, x in keep:
        if not xs or x - xs[-1] > 6:
            xs.append(x)
    return xs


def bright_boxes(im, y0, y1, lum=140, min_area=60):
    """ROI 内亮块（文字/图标）的 bbox，按 x 排序。"""
    px = im.load()
    Wd = im.width
    h = max(0, y1 - y0)
    m = [[False] * Wd for _ in range(h)]
    for j in range(h):
        for x in range(Wd):
            c = px[x, y0 + j]
            if 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > lum:
                m[j][x] = True
    seen = [[False] * Wd for _ in range(h)]
    out = []
    for j in range(h):
        for x in range(Wd):
            if seen[j][x] or not m[j][x]:
                continue
            st = [(j, x)]
            seen[j][x] = True
            n = 0
            x0 = x1 = x
            a0 = a1 = j
            while st:
                a, b = st.pop()
                n += 1
                x0, x1 = min(x0, b), max(x1, b)
                a0, a1 = min(a0, a), max(a1, a)
                for da in (-1, 0, 1):
                    for db in (-1, 0, 1):
                        na, nb = a + da, b + db
                        if 0 <= na < h and 0 <= nb < Wd and m[na][nb] and not seen[na][nb]:
                            seen[na][nb] = True
                            st.append((na, nb))
            if n >= min_area:
                out.append(dict(x=x0, y=y0 + a0, w=x1 - x0 + 1, h=a1 - a0 + 1, n=n))
    return sorted(out, key=lambda b: b["x"])


def accent_runs(im, y0, y1, min_run=40, max_run=260, x_max=520):
    """强调色（胶囊描边）水平长条：返回 [(y, x0, x1)]，长度限制在 40..260 px（一颗胶囊的宽度）。"""
    px = im.load()
    out = []
    for y in range(max(0, y0), min(im.height, y1)):
        cur = 0
        start = None
        for x in range(0, min(im.width, x_max)):
            c = px[x, y]
            if c[2] > c[0] + 22 and c[2] > 95:
                if cur == 0:
                    start = x
                cur += 1
            else:
                if min_run <= cur <= max_run:
                    out.append((y, start, x - 1))
                cur = 0
        if min_run <= cur <= max_run:
            out.append((y, start, x_max - 1))
    return out


def css(px: int) -> float:
    return round(px / 2, 1)


def measure(im: Image.Image, tab_css: float) -> list[dict]:
    """返回元素列表：name, x, y, w, h（CSS）。检测不到的元素给 None。"""
    im = to720(im)
    H = im.height
    t = int(tab_css * 2)
    els: list[dict] = []

    def add(name, x=None, y=None, w=None, h=None, note=""):
        els.append(dict(name=name,
                        x=css(x) if x is not None else None,
                        y=css(y) if y is not None else None,
                        w=css(w) if w is not None else None,
                        h=css(h) if h is not None else None,
                        note=note))

    # ---- 顶栏：品牌/搜索行（tab 行上方）
    tb = bright_boxes(im, max(0, t - 130), t - 6, lum=150, min_area=120)
    if tb:
        left = [b for b in tb if b["x"] < W * 0.6]
        right = [b for b in tb if b["x"] >= W * 0.6]
        if left:
            b = left[0]
            add("顶栏·品牌字", b["x"], b["y"], b["w"], b["h"])
        if right:
            b = right[-1]
            add("顶栏·搜索图标", b["x"], b["y"], b["w"], b["h"])
        ys = [b["y"] for b in tb]
        add("顶栏·行高", 0, min(ys), W, max(b["y"] + b["h"] for b in tb) - min(ys))

    # ---- 胶囊 tab 行（选中颗：描边长条的上/下边 + 左右端）
    ar = accent_runs(im, max(0, t - 40), t + 110)
    if ar:
        ys = [y for y, _, _ in ar]
        x0 = min(a for _, a, _ in ar)
        x1 = max(b for _, _, b in ar)
        add("胶囊·选中颗外框", x0, min(ys), x1 - x0 + 1, max(ys) - min(ys) + 1)
    tabs = bright_boxes(im, t - 10, t + 70, lum=130, min_area=80)
    # 合并成 4 个簇（间距 < 12px 的算同一颗）
    clusters: list[list[dict]] = []
    for b in tabs:
        if clusters and b["x"] - (clusters[-1][-1]["x"] + clusters[-1][-1]["w"]) < 16:
            clusters[-1].append(b)
        else:
            clusters.append([b])
    for i, cl in enumerate(clusters[:5], 1):
        x0 = min(b["x"] for b in cl)
        x1 = max(b["x"] + b["w"] for b in cl)
        y0 = min(b["y"] for b in cl)
        y1 = max(b["y"] + b["h"] for b in cl)
        add(f"胶囊·第{i}颗", x0, y0, x1 - x0, y1 - y0)

    # ---- Hero
    hp = row_edges(im, t + 20, min(H, t + 420))
    htop = peak(hp, t + 20, min(H, t + 420))
    if htop:
        hbot = block_bottom(im, htop, 700)
        if hbot:
            cols = strong_cols(im, htop + 30, min(hbot - 10, htop + 400))
            if len(cols) >= 2:
                add("Hero", cols[0], htop, cols[-1] - cols[0], hbot - htop)
            else:
                add("Hero", None, htop, None, hbot - htop, "左右边检测失败")

    # ---- 分区标题行（Hero 下方）
    if htop:
        hb = block_bottom(im, htop, 700) or htop + 560
        boxes = bright_boxes(im, hb + 4, min(H, hb + 110), lum=140, min_area=40)
        if boxes:
            # 按 x 间距 30px 合并成簇（一个词算一块）
            cl: list[list[dict]] = []
            for b in boxes:
                if cl and b["x"] - (cl[-1][-1]["x"] + cl[-1][-1]["w"]) < 30:
                    cl[-1].append(b)
                else:
                    cl.append([b])
            merged = [dict(x=min(b["x"] for b in c), y=min(b["y"] for b in c),
                           w=max(b["x"] + b["w"] for b in c) - min(b["x"] for b in c),
                           h=max(b["y"] + b["h"] for b in c) - min(b["y"] for b in c)) for c in cl]
            boxes = merged
            left = boxes[0]
            right = boxes[-1]
            add("分区标题·标题", left["x"], left["y"], left["w"], left["h"])
            if right is not left:
                add("分区标题·More", right["x"], right["y"], right["w"], right["h"])
            add("分区标题·行", 0, min(b["y"] for b in boxes), W,
                max(b["y"] + b["h"] for b in boxes) - min(b["y"] for b in boxes))

    # ---- 货架（分区标题下方）
    if htop:
        hb = block_bottom(im, htop, 700) or htop + 560
        st = hb + 120
        if st < H - 40:
            top = peak(row_edges(im, st, min(H, st + 120)), st, min(H, st + 120))
            if top:
                bot = block_bottom(im, top, 400)
                if bot:
                    cols = strong_cols(im, top + 20, min(bot, top + 260), frac=0.30)
                    edges = [cols[0]] + cols
                    cards = []
                    for i in range(len(cols) - 1):
                        if cols[i + 1] - cols[i] > 80:      # 卡的左右边之间
                            cards.append((cols[i], cols[i + 1]))
                    for i, (a, b) in enumerate(cards[:5], 1):
                        add(f"货架·卡{i}", a, top, b - a, bot - top)
                    for i in range(1, min(4, len(cards))):
                        add(f"货架·间距{i}", cards[i][0] - cards[i - 1][1], None,
                            cards[i][0] - cards[i - 1][1], None)

    # ---- 底栏
    bp = row_edges(im, H - 260, H - 6)
    cands = sorted([(s, y) for s, y in bp if s > max(q for q, _ in bp) * 0.45], key=lambda t: -t[1])
    btop = cands[0][1] if cands else None
    if btop:
        bbot = block_bottom(im, btop, 200) or H
        cols = strong_cols(im, btop + 10, min(bbot - 4, btop + 120), frac=0.30)
        if len(cols) >= 2:
            add("底栏", cols[0], btop, cols[-1] - cols[0], bbot - btop)
        else:
            add("底栏", None, btop, None, bbot - btop, "左右边检测失败")
        items = bright_boxes(im, btop + 8, min(bbot, btop + 110), lum=120, min_area=40)
        cl: list[list[dict]] = []
        for b in items:
            if cl and b["x"] - (cl[-1][-1]["x"] + cl[-1][-1]["w"]) < 14:
                cl[-1].append(b)
            else:
                cl.append([b])
        for i, c in enumerate(cl[:4], 1):
            x0 = min(b["x"] for b in c)
            x1 = max(b["x"] + b["w"] for b in c)
            y0 = min(b["y"] for b in c)
            y1 = max(b["y"] + b["h"] for b in c)
            add(f"底栏·入口{i}", x0, y0, x1 - x0, y1 - y0)

    return els
