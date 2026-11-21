import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Sheet } from "../src/shared/ui/ios/overlays";
import { Button } from "../src/shared/ui/ios/controls";
import "../src/index.css";

// 上游 205eb02 探针：安卓软键盘弹出时，底部面板里的输入框与提交按钮必须还在可视区。
// 桌面 Chromium 没法真的弹 IME，这里用「把视口压矮」模拟 WebView 被 adjustResize 顶起后的可视区，
// 面板跟着变矮，剩下的交给 DialogFrame 的 ResizeObserver 滚动。
function Harness() {
  const [open, setOpen] = useState(true);
  Object.assign(window, { keyboardSetOpen: setOpen });
  return (
    <div className="hg-canvas absolute inset-0">
      <Sheet open={open} onClose={() => setOpen(false)} label="登录" avoidNativeKeyboard>
        <div className="ios-auth" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="ios-dialog-heading">登录</h2>
          {/* 撑高内容，逼出「输入框在滚动区下部、面板一矮就掉出去」的真实情形 */}
          <div style={{ height: 260 }} aria-hidden="true" />
          <label className="ios-description" htmlFor="kb-account">账号</label>
          <input id="kb-account" className="ios-input" defaultValue="" autoComplete="username" />
          <label className="ios-description" htmlFor="kb-password">密码</label>
          <input id="kb-password" className="ios-input" type="password" autoComplete="current-password" />
          <Button id="kb-submit" variant="primary" className="ios-auth-submit" type="button">登录</Button>
        </div>
      </Sheet>
    </div>
  );
}

createRoot(document.querySelector("#root")!).render(<Harness />);
