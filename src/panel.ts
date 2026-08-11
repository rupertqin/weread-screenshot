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
  div.style.padding = "12px";
  div.style.borderRadius = "8px";
  div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  div.style.fontFamily = "Arial, sans-serif";
  div.style.fontSize = "12px";
  div.style.width = "240px";

  div.innerHTML =
    '<h4 style="margin: 0 0 8px 0; font-size: 14px;">双引擎无损导出助手</h4>' +
    '<div style="margin-bottom: 6px;">' +
    "<label>导出引擎:</label>" +
    '<select id="ipt-engine" style="width:100%; box-sizing:border-box; margin-top:2px; height: 24px;">' +
    `<option value="canvas" ${initial.engineMode === "canvas" ? "selected" : ""}>模式一：原生 Canvas 物理合并 (极速)</option>` +
    `<option value="html2canvas" ${initial.engineMode === "html2canvas" ? "selected" : ""}>模式二：html2canvas 容器渲染</option>` +
    "</select>" +
    "</div>" +
    '<div style="margin-bottom: 6px;">' +
    "<label>下一页选择器 (书本):</label>" +
    `<input type="text" id="ipt-next" value="${initial.nextSelector}" style="width:100%; box-sizing:border-box; margin-top:2px;">` +
    "</div>" +
    '<div style="margin-bottom: 6px;">' +
    "<label>下一章选择器 (章节):</label>" +
    `<input type="text" id="ipt-chapter" value="${initial.chapterSelector}" style="width:100%; box-sizing:border-box; margin-top:2px;">` +
    "</div>" +
    '<div style="margin-bottom: 6px;">' +
    "<label>画布/区域选择器:</label>" +
    `<input type="text" id="ipt-target" value="${initial.targetSelector}" style="width:100%; box-sizing:border-box; margin-top:2px;">` +
    "</div>" +
    '<div style="margin-bottom: 10px;">' +
    "<label>等待延迟 (毫秒):</label>" +
    `<input type="number" id="ipt-delay" value="${initial.delay}" style="width:100%; box-sizing:border-box; margin-top:2px;">` +
    "</div>" +
    '<div style="display: flex; justify-content: space-between;">' +
    '<button id="btn-start" style="padding: 5px 10px; cursor: pointer; background:#28a745; color:white; border:none; border-radius:3px;">开始</button>' +
    '<button id="btn-stop" style="padding: 5px 10px; cursor: pointer; background:#dc3545; color:white; border:none; border-radius:3px;">停止</button>' +
    '<button id="btn-reset" style="padding: 5px 5px; cursor: pointer; background:#6c757d; color:white; border:none; border-radius:3px;">重置页码</button>' +
    "</div>" +
    '<div style="margin-top: 8px; color: #666;" id="txt-status">' +
    "状态: " + getStatus() +
    "</div>";

  document.body.appendChild(div);

  const readConfig = (): Config => ({
    nextSelector: (div.querySelector("#ipt-next") as HTMLInputElement).value,
    chapterSelector: (div.querySelector("#ipt-chapter") as HTMLInputElement).value,
    targetSelector: (div.querySelector("#ipt-target") as HTMLInputElement).value,
    delay:
      parseInt((div.querySelector("#ipt-delay") as HTMLInputElement).value, 10) ||
      initial.delay,
    engineMode: (div.querySelector("#ipt-engine") as HTMLSelectElement)
      .value as Config["engineMode"],
  });

  // 智能联动：切换引擎时，自动调整默认选择器
  (div.querySelector("#ipt-engine") as HTMLSelectElement).addEventListener(
    "change",
    (e) => {
      const engine = (e.target as HTMLSelectElement).value;
      const targetIpt = div.querySelector("#ipt-target") as HTMLInputElement;
      if (engine === "html2canvas") {
        targetIpt.value = ".renderTargetContainer";
      } else {
        targetIpt.value = ".wr_canvasContainer canvas";
      }
      handlers.onConfigChange(readConfig());
    },
  );

  // 输入变化时保存配置
  div.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", () => handlers.onConfigChange(readConfig()));
  });

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
