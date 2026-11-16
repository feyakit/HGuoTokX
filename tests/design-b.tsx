import { ACCENT_BG, FALLBACK_SCHEME, assignSlots, contrast, parseHex, schemeFromPixels } from "../src/accent";

function fill(r: number, g: number, b: number, count = 32 * 57) {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return data;
}

const errors: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) errors.push(message); };

const dark = schemeFromPixels(fill(12, 12, 14));
check(dark.source === "fallback" && dark.accent === FALLBACK_SCHEME.accent, "近黑画面回退品牌紫");

const gray = schemeFromPixels(fill(140, 142, 144));
check(gray.source === "fallback", "低饱和画面回退");

const teal = schemeFromPixels(fill(22, 120, 150));
check(teal.source === "image", "有色彩的封面要取出主色");
check(contrast(parseHex(teal.accent), parseHex(ACCENT_BG)) >= 4.5, `强调色对比度不足 ${teal.accent}`);
check(contrast(parseHex(teal.second), parseHex(ACCENT_BG)) >= 3, `渐变色对比度不足 ${teal.second}`);

const red = schemeFromPixels(fill(150, 40, 36));
check(red.source === "image" && red.accent !== teal.accent, "不同封面得到不同强调色");
check(contrast(parseHex(red.accent), parseHex(ACCENT_BG)) >= 4.5, "暖色也要达到对比度");

const forward = assignSlots(["a", "b", "c"], ["b", "c", "d"]);
check(forward[1] === "b" && forward[2] === "c" && forward.includes("d") && !forward.includes("a"), `向前滑应留住已解码的两条 ${forward.join(",")}`);
const onward = assignSlots(forward, ["c", "d", "e"]);
check(onward.filter(Boolean).length === 3 && onward.includes("c") && onward.includes("d"), "池子始终只有 3 个槽");

const root = document.querySelector("#root");
if (root) root.textContent = errors.length ? errors.join("\n") : "design-b ok";
Object.assign(window, { designB: { passed: errors.length === 0, errors, teal, red } });
