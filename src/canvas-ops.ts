/**
 * 画布操作模块：把插图按物理位置合并进画布、克隆导出、裁切下载。
 *
 * 纯几何定位 + Canvas 2D 操作，不涉及网络。取图见 image-fetch.ts / image-load.ts。
 */

import { computeDrawRect, toRect } from "./merge";
import { isSafeToDraw, type DrawableImage } from "./image-load";

/** 元素 → 碰撞计算用的 Rect */
function rectOf(el: Element) {
  const r = el.getBoundingClientRect();
  return toRect(r.left, r.top, r.width, r.height);
}

/** 触发下载（基于 DataURL 字符串） */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const downloadLink = document.createElement("a");
  downloadLink.href = dataUrl;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

/** 触发下载（基于 Canvas 对象） */
function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  try {
    downloadDataUrl(canvas.toDataURL("image/png"), filename);
  } catch (e) {
    console.error("Canvas 导出失败：", e);
  }
}

/** 裁切 Canvas 并下载（用于 html2canvas 对半分割） */
export function cropCanvasAndDownload(
  sourceCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  filename: string,
): void {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  const ctx = tempCanvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  downloadCanvas(tempCanvas, filename);
}

/**
 * 在目标画布上按物理碰撞算法绘制与参考画布重叠的插图。
 *
 * @param drawCanvas  目标绘制画布（通常是内存中的克隆画布，未插入 DOM，rect 全 0）
 * @param refCanvas   用于坐标定位的参考画布（必须是仍在页面 DOM 中的原始画布）
 * @param images      待合并的插图（可绘制副本或原始 img 元素）
 */
export function mergeImagesToCanvas(
  drawCanvas: HTMLCanvasElement,
  refCanvas: HTMLCanvasElement,
  images: (DrawableImage | HTMLImageElement)[],
): void {
  const ctx = drawCanvas.getContext("2d");
  if (!ctx) return;

  // 必须用"仍在 DOM 中的原始画布"计算几何，克隆画布不在 DOM 中 rect 全为 0
  const canvasRect = rectOf(refCanvas);

  images.forEach((input) => {
    // 统一成 { el: 用于定位, img: 用于绘制 }
    const { el, img } = "el" in input ? input : { el: input, img: input };

    // 跳过不可安全绘制的图片，避免污染画布导致 toDataURL 抛 SecurityError
    if (!isSafeToDraw(img)) return;

    const draw = computeDrawRect(
      canvasRect,
      rectOf(el),
      drawCanvas.width,
      drawCanvas.height,
    );
    if (draw) {
      try {
        ctx.drawImage(img, draw.x, draw.y, draw.w, draw.h);
      } catch (e) {
        // 单张图片绘制失败不阻断整体导出
        console.error("插图合并失败，跳过该图片:", el.src, e);
      }
    }
  });
}

/**
 * 内存克隆合并算法：克隆"原始画布"并把插图合并上去，返回 DataURL。
 *
 * 关键：合并定位用的是原始画布（refCanvas，在 DOM 中），而非克隆画布。
 */
export function getMergedCanvasDataUrl(
  refCanvas: HTMLCanvasElement,
  images: (DrawableImage | HTMLImageElement)[],
): string {
  const clone = document.createElement("canvas");
  clone.width = refCanvas.width;
  clone.height = refCanvas.height;
  const ctx = clone.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(refCanvas, 0, 0);
  mergeImagesToCanvas(clone, refCanvas, images);
  return clone.toDataURL("image/png");
}
