/**
 * 悬浮控制面板模块
 *
 * 布局顺序：标题 → 导出模式 → 操作按钮 → 状态行。
 */

import type { Config } from "./config";

export interface PanelHandlers {
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onConfigChange: (config: Config) => void;
}

const PANEL_ID = "auto-screenshot-panel";
const STYLE_ID = "auto-screenshot-panel-style";

/** 面板样式（只注入一次） */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${PANEL_ID} {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 100000;
  width: 220px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  color: #303133;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC",
    "Microsoft YaHei", sans-serif;
  user-select: none;
}
#${PANEL_ID} .asp-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}
#${PANEL_ID} .asp-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
#${PANEL_ID} .asp-label {
  flex: none;
  margin-right: 6px;
  color: #606266;
  white-space: nowrap;
}
#${PANEL_ID} select {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 4px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #303133;
  font-size: 12px;
  cursor: pointer;
}
#${PANEL_ID} select:focus {
  outline: none;
  border-color: #409eff;
}
#${PANEL_ID} .asp-btn {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: filter 0.15s;
}
#${PANEL_ID} .asp-btn + .asp-btn {
  margin-left: 4px;
}
#${PANEL_ID} .asp-btn:hover {
  filter: brightness(1.08);
}
#${PANEL_ID} .asp-btn:active {
  filter: brightness(0.92);
}
#${PANEL_ID} .asp-primary {
  background: #28a745;
}
#${PANEL_ID} .asp-danger {
  background: #dc3545;
}
#${PANEL_ID} .asp-default {
  background: #6c757d;
}
#${PANEL_ID} .asp-status {
  margin-top: 2px;
  color: #909399;
  word-break: break-all;
}
`;
  document.head.appendChild(style);
}

export function createPanel(
  initial: Config,
  getStatus: () => string,
  handlers: PanelHandlers,
): HTMLDivElement {
  ensureStyle();

  const div = document.createElement("div");
  div.id = PANEL_ID;

  // 模式选择放在第一行（标题之下、按钮之上）
  div.innerHTML = `
    <div class="asp-title">双引擎无损导出</div>
    <div class="asp-row">
      <span class="asp-label">模式</span>
      <select id="ipt-engine" title="导出引擎">
        <option value="canvas" title="原生 Canvas 合成，速度最快">模式一 · Canvas</option>
        <option value="html2canvas" title="html2canvas 渲染整章，兼容性最好">模式二 · html2canvas</option>
      </select>
    </div>
    <div class="asp-row">
      <button id="btn-start" class="asp-btn asp-primary">开始</button>
      <button id="btn-stop" class="asp-btn asp-danger">停止</button>
      <button id="btn-reset" class="asp-btn asp-default">重置</button>
    </div>
    <div id="txt-status" class="asp-status">状态: ${getStatus()}</div>
  `;

  const engineSelect = div.querySelector("#ipt-engine") as HTMLSelectElement;
  engineSelect.value = initial.engineMode;

  document.body.appendChild(div);

  const readConfig = (): Config => ({
    nextSelector: initial.nextSelector,
    chapterSelector: initial.chapterSelector,
    targetSelector:
      engineSelect.value === "html2canvas"
        ? ".renderTargetContainer"
        : ".wr_canvasContainer canvas",
    delay: initial.delay,
    engineMode: engineSelect.value as Config["engineMode"],
  });

  // 引擎切换时保存配置
  engineSelect.addEventListener("change", () =>
    handlers.onConfigChange(readConfig()),
  );

  (div.querySelector("#btn-start") as HTMLButtonElement).addEventListener(
    "click",
    () => {
      handlers.onConfigChange(readConfig());
      handlers.onStart();
    },
  );
  (div.querySelector("#btn-stop") as HTMLButtonElement).addEventListener(
    "click",
    handlers.onStop,
  );
  (div.querySelector("#btn-reset") as HTMLButtonElement).addEventListener(
    "click",
    handlers.onReset,
  );

  return div;
}

export function updateStatus(el: HTMLElement | null, text: string): void {
  if (el) {
    el.innerText = "状态: " + text;
  }
}
