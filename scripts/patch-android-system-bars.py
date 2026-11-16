#!/usr/bin/env python3
"""把 Android 系统状态栏/导航栏改成透明 + 浅色图标（绘制在内容之上）。

背景：Tauri 2 的 MainActivity 模板只调用无参 enableEdgeToEdge()，
它按 SystemBarStyle.auto() 给系统栏加了一层"对比度遮罩"——浅色主题下
就是一条白色横条（真机 720×1280 实测亮度 238），压在深色视频上很割裂。

改法：把无参调用换成显式 dark(TRANSPARENT)，遮罩去掉，图标保持浅色
（和播放页深色玻璃底栏一致）。脚本幂等，找不到锚点直接报错退出，
避免悄悄出一个没改上的包。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src-tauri" / "gen" / "android"
MARKER = "// hguox: transparent system bars"
CALL = (
    "    enableEdgeToEdge(\n"
    "      statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),\n"
    "      navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)\n"
    "    )"
)


def main() -> int:
    if not ROOT.is_dir():
        print(f"[system-bars] 找不到 Android 工程：{ROOT}（先跑 tauri android init）", file=sys.stderr)
        return 1

    targets = sorted(ROOT.glob("app/src/main/java/**/MainActivity.kt"))
    if not targets:
        print("[system-bars] 找不到 MainActivity.kt", file=sys.stderr)
        return 1

    changed = 0
    for path in targets:
        src = path.read_text(encoding="utf-8")
        if MARKER in src:
            print(f"[system-bars] 已处理过：{path.name}")
            continue

        if "enableEdgeToEdge()" in src:
            src = src.replace("enableEdgeToEdge()", f"{MARKER}\n{CALL}", 1)
        elif "enableEdgeToEdge(" in src:
            src = re.sub(r"enableEdgeToEdge\([^)]*\)", f"{MARKER}\n{CALL}", src, count=1)
        else:
            # 老模板：自己插一段，放在 super.onCreate 之前
            if "enableEdgeToEdge" not in src:
                src = src.replace(
                    "import android.os.Bundle",
                    "import android.os.Bundle\nimport androidx.activity.enableEdgeToEdge",
                    1,
                )
            src = re.sub(
                r"(override fun onCreate\(savedInstanceState: Bundle\?\) \{\n)",
                r"\1" + MARKER + "\n" + CALL + "\n",
                src,
                count=1,
            )

        if MARKER not in src:
            print(f"[system-bars] 没能插入代码：{path}", file=sys.stderr)
            return 1

        path.write_text(src, encoding="utf-8")
        changed += 1
        print(f"[system-bars] 已改为透明：{path}")

    if changed == 0:
        print("[system-bars] 无改动（都已处理过）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
