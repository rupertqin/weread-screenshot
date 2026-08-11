/**
 * 微信读书自动截图 —— 主入口（工程化 + 单元测试版）
 *
 * 由 vite-plugin-monkey 构建为油猴单文件脚本。
 */

import {
  createGMStorage,
  loadConfig,
  saveConfig,
  type Config,
  type StorageLike,
} from "./config";
import { getReaderInfo, type ReaderInfo } from "./reader";
import {
  downloadDataUrl,
  bakeImagesToBase64,
  restoreImageSources,
  mergeImagesToCanvas,
  getMergedCanvasDataUrl,
  cropCanvasAndDownload,
} from "./capture";
import { getVisibleImages, simulateRealisticClick, injectGlobalCSS, injectStyle1CSS, removeStyle1CSS } from "./dom";
import { createPanel, updateStatus } from "./panel";
import html2canvas from "html2canvas";

export interface AppContext {
  storage: StorageLike;
  config: Config;
  isRunning: boolean;
  statusEl: HTMLElement | null;
}

export function createApp(): AppContext {
  return {
    storage: createGMStorage(),
    config: loadConfig(createGMStorage()),
    isRunning: false,
    statusEl: null,
  };
}

/** 结束任务并弹出总结 */
export function finishTask(ctx: AppContext, reason: string): void {
  ctx.isRunning = false;
  GM_setValue("isRunning", false);
  removeStyle1CSS();
  updateStatus(ctx.statusEl, "已完成！" + reason);

  const startPage = GM_getValue("session_startPage", 1);
  const savedCount = GM_getValue("session_savedCount", 0);
  const startTime = GM_getValue("session_startTime", Date.now());
  const endTime = Date.now();

  const durationSeconds = Math.round((endTime - startTime) / 1000);
  const endPage = GM_getValue("pageCounter", 1) - 1;
  const reader = getReaderInfo(document, ctx.config.chapterSelector, ctx.config.nextSelector);

  const summaryMessage =
    "🎉 微信读书自动截图任务已顺利完成！\n\n" +
    "📋 智能双引擎任务总结：\n" +
    "-----------------------------------\n" +
    "🔹 识别类型：" +
    (reader.mode === "chapter" ? "章节模式 (Chapter)" : "书本模式 (Book)") +
    "\n" +
    "🔹 页面范围：第 " +
    startPage +
    " " +
    (reader.mode === "chapter" ? "章" : "页") +
    " ➔ 第 " +
    endPage +
    " " +
    (reader.mode === "chapter" ? "章" : "页") +
    "\n" +
    "🔹 累计保存：" +
    savedCount +
    " 张无损合并原图\n" +
    "🔹 任务耗时：" +
    durationSeconds +
    " 秒\n" +
    "🔹 结束原因：" +
    reason +
    "\n" +
    "-----------------------------------\n" +
    "提示：支持原生 Canvas 高仿真合并与 html2canvas 一键章节长图模式。";

  setTimeout(() => alert(summaryMessage), 300);
}

/** 章节模式专属：平滑滚动到页面底部以触发 DOM 渲染与资源加载 */
async function smoothScrollToBottom(ctx: AppContext): Promise<boolean> {
  const distance = 200;
  const scrollDelay = 150;

  while (
    window.innerHeight + window.scrollY <
    document.documentElement.scrollHeight - 50
  ) {
    window.scrollBy(0, distance);
    await new Promise((resolve) => setTimeout(resolve, scrollDelay));
    if (!ctx.isRunning) return false;
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
  return true;
}

/** 解析页面 Canvas 列表 */
function collectCanvases(target: Element): HTMLCanvasElement[] {
  const list: HTMLCanvasElement[] = [];
  if (target instanceof HTMLCanvasElement) {
    list.push(target);
  } else {
    target.querySelectorAll("canvas").forEach((c) => list.push(c as HTMLCanvasElement));
  }
  return list;
}

/**
 * 收集待导出的全部画布。
 *
 * 优先用 targetSelector 在整页收集（水平双页时一个容器内可能含 2 个 canvas），
 * 若一个都匹配不到则回退到 target 内部的 canvas。
 */
function collectAllCanvases(
  target: Element,
  targetSelector: string,
  doc: Document = document,
): HTMLCanvasElement[] {
  const matched = Array.from(doc.querySelectorAll<HTMLCanvasElement>(targetSelector));
  if (matched.length > 0) {
    return matched;
  }
  return collectCanvases(target);
}

/** 执行单步（一次截图 + 跳转） */
export async function executeStep(ctx: AppContext): Promise<void> {
  if (!ctx.isRunning) return;

  const reader = getReaderInfo(document, ctx.config.chapterSelector, ctx.config.nextSelector);

  // 章节模式专属：平滑滚动到底部触发全章加载
  if (reader.mode === "chapter") {
    updateStatus(ctx.statusEl, "正在平滑细致滚动页面以彻底渲染全部内容...");
    const scrollSuccess = await smoothScrollToBottom(ctx);
    if (!scrollSuccess) return;
  }

  updateStatus(ctx.statusEl, "等待页面渲染...");
  await new Promise((resolve) => setTimeout(resolve, ctx.config.delay));
  if (!ctx.isRunning) return;

  const target = document.querySelector(ctx.config.targetSelector);
  if (!target) {
    finishTask(ctx, "未探测到书籍目标元素（可能已到达图书末端或加载失败）");
    return;
  }

  let pageNum = GM_getValue("pageCounter", 1);

  const canvasList = collectCanvases(document.querySelector(".wr_canvasContainer") || document.body);

  // ============ 样式 1 (水平单页) 注入检测 ============
  if (reader.mode === "horizontal" && canvasList.length === 1) {
    injectStyle1CSS();
  } else {
    removeStyle1CSS();
  }
  if (!ctx.isRunning) return;

  // 获取可见插图，并进行 302 烘焙
  const containerElement =
    document.querySelector<HTMLElement>(".renderTargetContainer") || document.body;
  const visibleImages = getVisibleImages(containerElement);
  let bakedSources: { el: HTMLImageElement; src: string }[] = [];
  if (visibleImages.length > 0) {
    updateStatus(ctx.statusEl, "正在预解析插图并追踪 302 跳转...");
    bakedSources = await bakeImagesToBase64(visibleImages);
  }

  // ========== 核心：双引擎逻辑分支 ==========
  if (ctx.config.engineMode === "canvas") {
    // ---- 引擎一：原生 Canvas 模式 ----
    // 收集全部画布：水平双页时一个容器内通常有 2 个 canvas，必须全部导出
    const engineCanvases = collectAllCanvases(target, ctx.config.targetSelector);
    if (engineCanvases.length === 0) {
      finishTask(ctx, "原生 Canvas 模式下未找到可用的 Canvas 画布");
      restoreImageSources(bakedSources);
      return;
    }

    updateStatus(ctx.statusEl, "正在通过原生 Canvas 进行碰撞合并导出...");

    if (reader.mode === "chapter") {
      for (let index = 0; index < engineCanvases.length; index++) {
        const canvas = engineCanvases[index];
        const mergedDataUrl = getMergedCanvasDataUrl(canvas, visibleImages);
        downloadDataUrl(mergedDataUrl, `screenshot_page_${pageNum}-${index + 1}.png`);
        await new Promise((r) => setTimeout(r, 300));
      }
      GM_setValue("pageCounter", pageNum + 1);
      updateStatus(ctx.statusEl, `[Canvas] 已保存并合成第 ${pageNum} 章共 ${engineCanvases.length} 页`);
    } else {
      for (let index = 0; index < engineCanvases.length; index++) {
        const canvas = engineCanvases[index];
        const mergedDataUrl = getMergedCanvasDataUrl(canvas, visibleImages);
        downloadDataUrl(mergedDataUrl, `screenshot_page_${pageNum + index}.png`);
        await new Promise((r) => setTimeout(r, 300));
      }
      GM_setValue("pageCounter", pageNum + engineCanvases.length);
      updateStatus(ctx.statusEl, `[Canvas] 已自适应并合成当前视窗内的 ${engineCanvases.length} 页`);
    }
  } else {
    // ---- 引擎二：html2canvas 模式 ----
    updateStatus(ctx.statusEl, "正在通过 html2canvas 渲染整页/整章长图...");

    const h2cTarget =
      document.querySelector<HTMLElement>(".renderTargetContainer") ||
      (target as HTMLElement);

    const pager = document.querySelector(".renderTargetContainer .renderTarget_pager") as HTMLElement | null;
    const header = document.querySelector(
      ".renderTargetContainer .renderTargetPageInfo_header",
    ) as HTMLElement | null;

    const origPagerVis = pager ? pager.style.visibility : "";
    const origHeaderVis = header ? header.style.visibility : "";
    if (pager) pager.style.visibility = "hidden";
    if (header) header.style.visibility = "hidden";

    try {
      const innerCanvasCount = canvasList.length;

      const h2cOptions: Record<string, unknown> = {
        useCORS: true,
        logging: false,
        allowTaint: true,
      };

      // 仅在水平书本模式下执行克隆 DOM 物理碰撞融合
      if (reader.mode === "horizontal") {
        h2cOptions.onclone = (clonedDoc: Document) => {
          const clonedTarget =
            clonedDoc.querySelector<HTMLElement>(".renderTargetContainer") ||
            clonedDoc.body;
          const clonedCanvases = clonedTarget.querySelectorAll("canvas");
          const clonedVisibleImages = getVisibleImages(clonedTarget);
          clonedCanvases.forEach((canvas) => {
            // 克隆 DOM 中的 canvas 具有有效布局，可直接作为参考画布
            mergeImagesToCanvas(
              canvas as HTMLCanvasElement,
              canvas as HTMLCanvasElement,
              clonedVisibleImages,
            );
          });
        };
      }

      const renderedCanvas = await html2canvas(h2cTarget, h2cOptions);

      if (!ctx.isRunning) return;

      // 只在"水平模式且含2个Canvas"时对半切分；章节模式绝不切分
      if (reader.mode === "horizontal" && innerCanvasCount === 2) {
        const originalWidth = renderedCanvas.width;
        const originalHeight = renderedCanvas.height;
        const halfWidth = originalWidth / 2;

        cropCanvasAndDownload(renderedCanvas, 0, 0, halfWidth, originalHeight, `screenshot_page_${pageNum}.png`);
        await new Promise((r) => setTimeout(r, 300));
        cropCanvasAndDownload(renderedCanvas, halfWidth, 0, halfWidth, originalHeight, `screenshot_page_${pageNum + 1}.png`);

        GM_setValue("pageCounter", pageNum + 2);
        updateStatus(ctx.statusEl, `[html2canvas] 水平双页切分已保存第 ${pageNum} 和 ${pageNum + 1} 页`);
      } else {
        const dataUrl = renderedCanvas.toDataURL("image/png");
        downloadDataUrl(dataUrl, `screenshot_page_${pageNum}.png`);
        GM_setValue("pageCounter", pageNum + 1);
        updateStatus(ctx.statusEl, `[html2canvas] 已成功导出整页/整章长图第 ${pageNum} 页`);
      }
    } catch (err) {
      console.error("html2canvas 渲染失败:", err);
      updateStatus(ctx.statusEl, "渲染截图失败，尝试继续...");
    } finally {
      restoreImageSources(bakedSources);
      if (pager) pager.style.visibility = origPagerVis;
      if (header) header.style.visibility = origHeaderVis;
    }
  }

  if (!ctx.isRunning) return;

  // 获取并触发跳转
  const nextBtn = document.querySelector(reader.nextBtnSelector) as HTMLElement | null;
  const isBtnVisible =
    reader.mode === "chapter"
      ? !!nextBtn
      : !!nextBtn && (nextBtn.offsetWidth > 0 || nextBtn.offsetHeight > 0);

  if (nextBtn && isBtnVisible) {
    updateStatus(ctx.statusEl, "正在跳转...");
    simulateRealisticClick(nextBtn);
    setTimeout(() => {
      if (ctx.isRunning) {
        void executeStep(ctx);
      }
    }, 1200);
  } else {
    finishTask(ctx, "未探测到后续翻页按钮（书本已到最后一页或最后一章）");
  }
}

/** 初始化入口 */
export function init(): void {
  const ctx = createApp();
  injectGlobalCSS();

  const panel = createPanel(
    ctx.config,
    () => `第 ${GM_getValue("pageCounter", 1)} ${ctx.config.engineMode === "canvas" ? "页" : "章"}`,
    {
      onStart: () => start(ctx),
      onStop: () => stop(ctx),
      onReset: () => {
        GM_setValue("pageCounter", 1);
        updateStatus(ctx.statusEl, "页码已重置为 1");
      },
      onConfigChange: (cfg) => {
        ctx.config = cfg;
        saveConfig(ctx.storage, cfg);
      },
    },
  );
  ctx.statusEl = panel.querySelector("#txt-status");

  if (GM_getValue("isRunning", false)) {
    ctx.isRunning = true;
    void executeStep(ctx);
  }
}

export function start(ctx: AppContext): void {
  if (ctx.isRunning) {
    updateStatus(ctx.statusEl, "已在运行中，请勿重复点击");
    return;
  }
  GM_setValue("session_startPage", GM_getValue("pageCounter", 1));
  GM_setValue("session_savedCount", 0);
  GM_setValue("session_startTime", Date.now());
  GM_setValue("isRunning", true);
  ctx.isRunning = true;
  updateStatus(ctx.statusEl, "正在启动...");
  void executeStep(ctx);
}

export function stop(ctx: AppContext): void {
  GM_setValue("isRunning", false);
  ctx.isRunning = false;
  removeStyle1CSS();
  updateStatus(ctx.statusEl, "已暂停");
}

// 浏览器端挂载：延迟初始化
if (typeof window !== "undefined" && typeof document !== "undefined") {
  setTimeout(() => {
    init();
  }, 500);
}
