import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../src/shared/ui/ios/overlays";
import "../src/index.css";

// 上游 7ab0a51 探针：一套页面壳（标题 + 滚动体）加一个浮层，
// 由脚本改 --sal/--sar 模拟刘海/横屏的非对称安全区，检查几何是否跟着走。
function Harness() {
  const [open, setOpen] = useState(true);
  Object.assign(window, { safeAreaSetOpen: setOpen });
  return (
    <div className="hg-canvas absolute inset-0">
      <div className="ios-page absolute inset-0 flex flex-col">
        <header className="shrink-0">
          <h1 className="ios-page-title">标题</h1>
        </header>
        <div className="scroll-y flex-1">
          {"<p>占位行</p>".repeat(1).length > 0 && <p>内容</p>}
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} label="浮层">
        <div style={{ padding: 20 }}>浮层内容</div>
      </Modal>
    </div>
  );
}

createRoot(document.querySelector("#root")!).render(<Harness />);
