/**
 * 核心截图逻辑模块：双引擎导出 + 插图烘焙 + 画布合并
 */

import { computeDrawRect } from "./merge";

/** 触发下载（基于 DataURL 字符串），返回是否成功 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const downloadLink = document.createElement("a");
  downloadLink.href = dataUrl;
  downloadLink.download = filename;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

/** 触发下载（基于 Canvas 对象） */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
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
 * 在 Canvas 表面重构绝对定位的插图（AABB 碰撞合并）
 * 使用 computeDrawRect 计算坐标，仅绘制与画布重叠的插图。
 */
export function mergeImagesToCanvas(
  canvas: HTMLCanvasElement,
  images: HTMLImageElement[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rectCanvas = canvas.getBoundingClientRect();
  const canvasRect = {
    left: rectCanvas.left,
    top: rectCanvas.top,
    right: rectCanvas.right,
    bottom: rectCanvas.bottom,
    width: rectCanvas.width,
    height: rectCanvas.height,
  };

  images.forEach((img) => {
    const rectImg = img.getBoundingClientRect();
    const imgRect = {
      left: rectImg.left,
      top: rectImg.top,
      right: rectImg.right,
      bottom: rectImg.bottom,
      width: rectImg.width,
      height: rectImg.height,
    };

    const draw = computeDrawRect(canvasRect, imgRect, canvas.width, canvas.height);
    if (draw) {
      ctx.drawImage(img, draw.x, draw.y, draw.w, draw.h);
    }
  });
}

/** 内存克隆合并算法：克隆画布并把插图合并上去，返回 DataURL */
export function getMergedCanvasDataUrl(
  canvas: HTMLCanvasElement,
  images: HTMLImageElement[],
): string {
  const clone = document.createElement("canvas");
  clone.width = canvas.width;
  clone.height = canvas.height;
  const ctx = clone.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(canvas, 0, 0);
  mergeImagesToCanvas(clone, images);
  return clone.toDataURL("image/png");
}

/**
 * 追踪图片 302 重定向并就地烘焙成 Base64
 * 返回原始 src 列表，便于之后还原。
 */
export async function bakeImagesToBase64(
  images: HTMLImageElement[],
  fetchFn: typeof fetch = fetch,
): Promise<{ el: HTMLImageElement; src: string }[]> {
  const originalSources: { el: HTMLImageElement; src: string }[] = [];

  for (const img of images) {
    const originalSrc = img.src;
    originalSources.push({ el: img, src: originalSrc });

    if (originalSrc.indexOf("data:") === 0) {
      continue;
    }

    try {
      const response = await fetchFn(originalSrc);
      if (!response.ok) throw new Error("Fetch failed");

      const blob = await response.blob();

      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      img.src = base64Data;
    } catch (err) {
      console.error("图片烘焙失败，保留原地址:", originalSrc, err);
    }
  }
  return originalSources;
}

/** 还原图片的原始 src 地址 */
export function restoreImageSources(
  sources: { el: HTMLImageElement; src: string }[],
): void {
  sources.forEach((item) => {
    item.el.src = item.src;
  });
}
