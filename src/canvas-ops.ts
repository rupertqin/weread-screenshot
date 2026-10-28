/**
 * 画布操作模块：把插图按物理位置合并进画布、编码导出、裁切下载。
 *
 * 纯几何定位 + Canvas 2D 操作，不涉及网络。取图见 image-fetch.ts / image-load.ts。
 */

import { computeDrawRect, toRect } from "./merge";
import { isSafeToDraw, type DrawableImage } from "./image-load";

/**
 * 导出格式。
 *
 * - `png`：无损，兼容性最好，但截图体积大（文字抗锯齿细节几乎无法压缩）；
 * - `webp`：有损，体积通常只有 PNG 的 1/4 左右，文字依然清晰，且保留透明通道。
 *
 * 不支持 WebP 的浏览器会在 `toDataURL` 时静默回落为 PNG，文件名后缀会自动跟随实际格式。
 */
export type ImageFormat = "png" | "webp";

const MIME: Record<ImageFormat, string> = {
  png: "image/png",
  webp: "image/webp",
};

/** WebP 编码质量：0.95 对文字截图基本看不出损失 */
export const WEBP_QUALITY = 0.95;

export interface EncodedImage {
  dataUrl: string;
  /** 实际扩展名（浏览器不支持 WebP 时会是 png） */
  ext: string;
}

/** 元素 → 碰撞计算用的 Rect */
function rectOf(el: Element) {
  const r = el.getBoundingClientRect();
  return toRect(r.left, r.top, r.width, r.height);
}

/**
 * 把画布编码成图片数据。
 *
 * 以 `dataUrl` 里**真实的 MIME** 决定扩展名：某些环境不支持 WebP 时，
 * `toDataURL("image/webp")` 会静默返回 PNG 数据，若仍按 .webp 命名会造成「扩展名与内容不符」。
 */
export function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: ImageFormat,
): EncodedImage {
  const dataUrl = canvas.toDataURL(
    MIME[format],
    format === "png" ? undefined : WEBP_QUALITY,
  );

  const mime = /^data:image\/([a-z]+)/i.exec(dataUrl)?.[1]?.toLowerCase();
  const ext = mime === "jpeg" ? "jpg" : mime || "png";

  return { dataUrl, ext };
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

/**
 * 编码并下载画布。
 *
 * @param baseName 不含扩展名的文件名，扩展名按实际编码格式自动补
 */
export function downloadCanvas(
  canvas: HTMLCanvasElement,
  baseName: string,
  format: ImageFormat = "png",
): void {
  try {
    const { dataUrl, ext } = encodeCanvas(canvas, format);
    downloadDataUrl(dataUrl, `${baseName}.${ext}`);
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
  baseName: string,
  format: ImageFormat = "png",
): void {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  const ctx = tempCanvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  downloadCanvas(tempCanvas, baseName, format);
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
 * 内存克隆合并算法：克隆"原始画布"并把插图合并上去，返回编码结果。
 *
 * 关键：合并定位用的是原始画布（refCanvas，在 DOM 中），而非克隆画布。
 */
export function getMergedCanvasExport(
  refCanvas: HTMLCanvasElement,
  images: (DrawableImage | HTMLImageElement)[],
  format: ImageFormat = "png",
): EncodedImage {
  const clone = document.createElement("canvas");
  clone.width = refCanvas.width;
  clone.height = refCanvas.height;
  const ctx = clone.getContext("2d");
  if (!ctx) return { dataUrl: "", ext: format };

  ctx.drawImage(refCanvas, 0, 0);
  mergeImagesToCanvas(clone, refCanvas, images);
  return encodeCanvas(clone, format);
}
