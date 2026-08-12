/**
 * 悬浮控制面板模块
 */

import type { Config } from "./config";

export interface PanelHandlers {
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onConfigChange: (config: Config) => void;
}

export function createPanel(
  initial: Config,
  getStatus: () => string,
  handlers: PanelHandlers,
): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "auto-screenshot-panel";
  div.style.position = "fixed";
  div.style.top = "20px";
  div.style.right = "20px";
  div.style.zIndex = "100000";
  div.style.background = "#ffffff";
  div.style.border = "1px solid #ccc";
  div.style.padding = "10px 12px";
  div.style.borderRadius = "8px";
  div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  div.style.fontFamily = "Arial, sans-serif";
  div.style.fontSize = "12px";
  div.style.width = "220px";
  div.style.lineHeight = "1.4";

  div.innerHTML =
    '<h4 style="margin: 0 0 8px 0; font-size: 14px;">双引擎无损导出助手</h4>' +
    '<div style="margin-bottom: 8px; display: flex; justify-content: space-between;">' +
    '<button id="btn-start" style="flex:1; margin-right:4px; padding: 5px 10px; cursor: pointer; background:#28a745; color:white; border:none; border-radius:3px;">开始</button>' +
    '<button id="btn-stop" style="flex:1; margin-right:4px; padding: 5px 10px; cursor: pointer; background:#dc3545; color:white; border:none; border-radius:3px;">停止</button>' +
    '<button id="btn-reset" style="flex:1; padding: 5px 5px; cursor: pointer; background:#6c757d; color:white; border:none; border-radius:3px;">重置页码</button>' +
    "</div>" +
    '<div style="color: #666;" id="txt-status">' +
    "状态: " + getStatus() +
    "</div>";

  document.body.appendChild(div);

  // 引擎切换（保留核心功能切换）
  const engineLabel = document.createElement("div");
  engineLabel.style.cssText = "margin-bottom:8px; display:flex; align-items:center;";
  engineLabel.innerHTML =
    "<label style='margin-right:8px; white-space:nowrap;'>导出引擎:</label>" +
    '<select id="ipt-engine" style="flex:1; height:24px;">' +
    `<option value="canvas" ${initial.engineMode === "canvas" ? "selected" : ""}>模式一：原生 Canvas (极速)</option>` +
    `<option value="html2canvas" ${initial.engineMode === "html2canvas" ? "selected" : ""}>模式二：html2canvas 渲染</option>` +
    "</select>";
  div.insertBefore(engineLabel, div.querySelector("#txt-status"));

  const readConfig = (): Config => ({
    nextSelector: initial.nextSelector,
    chapterSelector: initial.chapterSelector,
    targetSelector:
      (div.querySelector("#ipt-engine") as HTMLSelectElement).value === "html2canvas"
        ? ".renderTargetContainer"
        : ".wr_canvasContainer canvas",
    delay: initial.delay,
    engineMode: (div.querySelector("#ipt-engine") as HTMLSelectElement)
      .value as Config["engineMode"],
  });

  // 引擎切换时保存配置
  (div.querySelector("#ipt-engine") as HTMLSelectElement).addEventListener(
    "change",
    () => handlers.onConfigChange(readConfig()),
  );

  (div.querySelector("#btn-start") as HTMLButtonElement).addEventListener(
    "click",
    () => {
      handlers.onConfigChange(readConfig());
      handlers.onStart();
    },
  );
  (div.querySelector("#btn-stop") as HTMLButtonElement).addEventListener("click", handlers.onStop);
  (div.querySelector("#btn-reset") as HTMLButtonElement).addEventListener("click", handlers.onReset);

  return div;
}

export function updateStatus(el: HTMLElement | null, text: string): void {
  if (el) {
    el.innerText = "状态: " + text;
  }
}
