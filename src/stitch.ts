/**
 * 分段滚动截图 + 拼接成一张长图（模式二·章节模式专用）
 *
 * 背景：微信读书章节虚拟渲染。`.renderTargetContainer` 高度 = 全文高度（被内部写死高度
 * 的元素撑起），但滚动时视口外的内容会被清空，导致"一次性整章渲染"出现大片空白。
 *
 * 本模块策略（以全图渲染 + 可见区域覆盖）：
 *   1. 逐段滚动外层滚动容器到 currentY；
 *   2. 每段用 html2canvas 渲染整个 `.renderTargetContainer`（此时只有当前视口附近内容完整）；
 *   3. 把该次渲染中"可见区域"（y = currentY 起，高 = 视口高）复制到底板的对应偏移位置；
 *   4. 所有可见区域都被覆盖后，底板即为完整章节长图。
 */

import type { AppContext } from "./main";

export interface StitchOptions {
  /** 截图目标容器（.renderTargetContainer） */
  target: HTMLElement;
  /** 视口高度 */
  viewportHeight: number;
  /** 相邻段重叠比例（0~1），用于避免拼接缝隙 */
  overlapRatio?: number;
  /** 每段截图后等待渲染的毫秒数 */
  renderDelay?: number;
  /** html2canvas 额外选项 */
  h2cOptions?: Record<string, unknown>;
  /**
   * 每段"滚动并等待渲染后、html2canvas 渲染前"的预处理回调。
   * 用于烘焙该段视口内出现的插图（base64），避免 html2canvas 跨域污染画布。
   */
  beforeCapture?: (scrollY: number) => Promise<unknown>;
  /** 每段"html2canvas 渲染完成后"的还原回调 */
  afterCapture?: (payload: unknown) => void;
}

export interface StitchProgress {
  /** 当前滚动偏移 */
  scrollY: number;
  /** 内容总高度 */
  totalHeight: number;
  /** 段序号（从 0 开始） */
  index: number;
}

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 定位最合适的滚动容器（外层，负责滚动章节内容） */
function getScrollElement(doc: Document = document): HTMLElement {
  const se = doc.scrollingElement;
  if (se && se.scrollHeight > se.clientHeight) return se as HTMLElement;
  if (doc.body.scrollHeight > doc.body.clientHeight) return doc.body;
  return (se as HTMLElement) || doc.body;
}

/**
 * 分段截图并拼接成一张长图，返回最终的 HTMLCanvasElement。
 */
export async function stitchFullPage(
  ctx: AppContext,
  html2canvasFn: (
    element: HTMLElement,
    options?: Record<string, unknown>,
  ) => Promise<HTMLCanvasElement>,
  opts: StitchOptions,
  onProgress?: (p: StitchProgress) => void,
): Promise<HTMLCanvasElement> {
  const { target, viewportHeight } = opts;
  const overlapRatio = opts.overlapRatio ?? 0.05;
  const renderDelay = opts.renderDelay ?? 80;

  const scrollEl = getScrollElement();

  // 全文高度 = .renderTargetContainer 的 scrollHeight（被内部元素撑起）
  const totalHeight = target.scrollHeight || scrollEl.scrollHeight || 0;
  if (totalHeight <= 0) {
    throw new Error("无法获取目标容器高度");
  }

  // 步长 = 视口高度 * (1 - 重叠比例)，保证每个可见区域至少被一次渲染覆盖
  const step = Math.max(viewportHeight * (1 - overlapRatio), 1);

  // 备份起始滚动位置，结束恢复
  const startScrollY = scrollEl.scrollTop;

  // 底板：以首段渲染的 canvas 像素尺寸确定宽度，高度 = 全文高
  let baseCanvas: HTMLCanvasElement | null = null;
  let baseCtx: CanvasRenderingContext2D | null = null;
  let segWidthPx = 0;

  try {
    let currentY = 0;
    let index = 0;
    while (true) {
      if (!ctx.isRunning) {
        throw new Error("任务已停止");
      }

      // 1. 滚动到当前段，触发微信读书渲染该段附近内容
      scrollEl.scrollTop = currentY;
      window.scrollTo(0, currentY);

      // 2. 等待虚拟渲染
      await sleep(renderDelay);

      // 3. 预处理该段视口内的插图（烘焙 base64）
      const payload = opts.beforeCapture
        ? await opts.beforeCapture(currentY)
        : undefined;

      // 4. 渲染整个 .renderTargetContainer（当前视口附近内容完整）
      //    强制 scale:1，使 canvas 像素 == CSS 像素，滚动偏移直接对应坐标
      let fullCanvas: HTMLCanvasElement;
      try {
        fullCanvas = await html2canvasFn(target, {
          ...opts.h2cOptions,
          scale: 1,
        });
      } finally {
        if (opts.afterCapture && payload !== undefined) {
          opts.afterCapture(payload);
        }
      }

      // 5. 首段确定底板尺寸（用渲染 canvas 的实际像素宽，避免 DPR 缩放变形）
      if (!baseCanvas) {
        segWidthPx = fullCanvas.width;
        baseCanvas = document.createElement("canvas");
        baseCanvas.width = segWidthPx;
        baseCanvas.height = Math.ceil(totalHeight);
        baseCtx = baseCanvas.getContext("2d");
        if (!baseCtx) {
          throw new Error("无法创建拼接画布");
        }
      }

      // 6. 把该次渲染的"可见区域"复制到底板的对应偏移位置
      //    可见区域 = y 从 currentY 起、高 viewportHeight（受限于全文剩余高度）
      const segH = Math.min(viewportHeight, totalHeight - currentY);
      if (segH > 0 && baseCtx) {
        baseCtx.drawImage(
          fullCanvas,
          0, currentY, segWidthPx, segH,   // 源区域（canvas 像素坐标系）
          0, currentY, segWidthPx, segH,   // 目标位置（1:1，无缩放）
        );
      }

      if (onProgress) {
        onProgress({ scrollY: currentY, totalHeight, index });
      }

      // 7. 判断是否已滚动到底
      if (currentY + viewportHeight >= totalHeight) {
        break;
      }

      currentY += step;
      index += 1;

      if (currentY >= totalHeight + viewportHeight) {
        break;
      }
    }

    if (!baseCanvas || !baseCtx) {
      throw new Error("未生成任何分段");
    }

    return baseCanvas;
  } finally {
    // 恢复原始滚动位置
    scrollEl.scrollTop = startScrollY;
    window.scrollTo(0, startScrollY);
  }
}
