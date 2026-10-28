/**
 * 悬浮控制面板模块
 *
 * 布局顺序：标题 → 导出模式 → 操作按钮 → 状态行。
 */

import type { Config } from "./config";

export interface PanelHandlers {
  onStart: () => void;
  onStop: () => void;
  onConfigChange: (config: Config) => void;
}

export const PANEL_ID = "auto-screenshot-panel";
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
  /* 收起时宽度按标题实际宽度收紧，这里保证过渡而不是突变 */
  transition: width 0.22s ease;
}
#${PANEL_ID} .asp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  transition: margin-bottom 0.22s ease;
}
#${PANEL_ID} .asp-title {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
#${PANEL_ID} .asp-toggle {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: 8px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #909399;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
#${PANEL_ID} .asp-toggle:hover {
  background: #f2f3f5;
  color: #303133;
}
#${PANEL_ID} .asp-toggle svg {
  transition: transform 0.22s ease;
}
#${PANEL_ID} .asp-body {
  overflow: hidden;
  max-height: 220px;
  opacity: 1;
  transition: max-height 0.22s ease, opacity 0.18s ease;
}
#${PANEL_ID}.is-collapsed .asp-head {
  margin-bottom: 0;
}
#${PANEL_ID}.is-collapsed .asp-body {
  max-height: 0;
  opacity: 0;
}
#${PANEL_ID}.is-collapsed .asp-toggle svg {
  transform: rotate(180deg);
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
#${PANEL_ID} select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

export interface PanelHandle {
  /** 面板根元素 */
  el: HTMLDivElement;
  /** 切换运行态：运行中只显示「停止」，空闲只显示「开始」 */
  setRunning: (running: boolean) => void;
}

export function createPanel(
  initial: Config,
  getStatus: () => string,
  handlers: PanelHandlers,
): PanelHandle {
  ensureStyle();

  const div = document.createElement("div");
  div.id = PANEL_ID;

  // 标题栏（可点击收起）+ 可折叠的主体
  // 模式选择放在第一行（标题之下、按钮之上）
  // 开始/停止互斥：同一时刻只显示一个
  div.innerHTML = `
    <div class="asp-head">
      <span class="asp-title">截图导出</span>
      <button
        id="btn-collapse"
        class="asp-toggle"
        type="button"
        title="收起"
        aria-label="收起面板"
        aria-expanded="true"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M3.5 9.5L8 5l4.5 4.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
    <div class="asp-body">
      <div class="asp-row">
        <span class="asp-label">模式</span>
        <select id="ipt-engine" title="导出引擎">
          <option value="canvas" title="原生 Canvas 合成，速度最快">模式一 · Canvas</option>
          <option value="html2canvas" title="html2canvas 渲染整章，兼容性最好">模式二 · html2canvas</option>
        </select>
      </div>
      <div class="asp-row">
        <button id="btn-start" class="asp-btn asp-primary" type="button">开始</button>
        <button id="btn-stop" class="asp-btn asp-danger" type="button" style="display: none;">停止</button>
      </div>
      <div id="txt-status" class="asp-status">状态: ${getStatus()}</div>
    </div>
  `;

  const engineSelect = div.querySelector("#ipt-engine") as HTMLSelectElement;
  engineSelect.value = initial.engineMode;

  const startBtn = div.querySelector("#btn-start") as HTMLButtonElement;
  const stopBtn = div.querySelector("#btn-stop") as HTMLButtonElement;
  const collapseBtn = div.querySelector("#btn-collapse") as HTMLButtonElement;

  const setRunning = (running: boolean): void => {
    startBtn.style.display = running ? "none" : "";
    stopBtn.style.display = running ? "" : "none";
    // 运行中禁止改模式，避免中途切换导致 targetSelector 错配
    engineSelect.disabled = running;
  };
  setRunning(false);

  const titleEl = div.querySelector(".asp-title") as HTMLElement;

  /**
   * 收起时把卡片宽度收到「标题实际宽度 + 收起按钮占位」，不再固定 220px。
   *
   * 宽度写在内联样式上，配合 CSS 的 `transition: width` 才有动画；
   * 展开时清空内联宽度即可回落到样式表里的 220px。
   *
   * 取不到测量值（如测试环境无布局）时不写宽度，退回样式表默认值。
   */
  const fitToTitle = (): void => {
    const titleWidth = titleEl.getBoundingClientRect().width;
    if (!titleWidth) {
      div.style.width = "";
      return;
    }

    const toggleStyle = getComputedStyle(collapseBtn);
    const gap = parseFloat(toggleStyle.marginLeft) || 8;
    const toggleWidth = collapseBtn.getBoundingClientRect().width || 20;

    div.style.width = `${Math.ceil(titleWidth + gap + toggleWidth)}px`;
  };

  const setCollapsed = (collapsed: boolean): void => {
    div.classList.toggle("is-collapsed", collapsed);
    collapseBtn.title = collapsed ? "展开" : "收起";
    collapseBtn.setAttribute("aria-label", collapsed ? "展开面板" : "收起面板");
    collapseBtn.setAttribute("aria-expanded", String(!collapsed));

    if (collapsed) {
      fitToTitle();
    } else {
      div.style.width = "";
    }
  };
  setCollapsed(false);

  collapseBtn.addEventListener("click", () => {
    setCollapsed(!div.classList.contains("is-collapsed"));
  });

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

  startBtn.addEventListener("click", () => {
    handlers.onConfigChange(readConfig());
    handlers.onStart();
  });
  stopBtn.addEventListener("click", handlers.onStop);

  return { el: div, setRunning };
}

export function updateStatus(el: HTMLElement | null, text: string): void {
  if (el) {
    el.innerText = "状态: " + text;
  }
}
