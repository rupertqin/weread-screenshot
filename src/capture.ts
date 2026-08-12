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
 * 在目标画布上按物理碰撞算法绘制与参考画布重叠的插图。
 *
 * @param drawCanvas  目标绘制画布（通常是内存中的克隆画布，未插入 DOM，rect 全 0）
 * @param refCanvas   用于坐标定位的参考画布（必须是仍在页面 DOM 中的原始画布）
 * @param images      待合并的可见插图
 */
export function mergeImagesToCanvas(
  drawCanvas: HTMLCanvasElement,
  refCanvas: HTMLCanvasElement,
  images: HTMLImageElement[],
): void {
  const ctx = drawCanvas.getContext("2d");
  if (!ctx) return;

  // 必须用"仍在 DOM 中的原始画布"计算几何，克隆画布不在 DOM 中 rect 全为 0
  const rectCanvas = refCanvas.getBoundingClientRect();
  const canvasRect = {
    left: rectCanvas.left,
    top: rectCanvas.top,
    right: rectCanvas.right,
    bottom: rectCanvas.bottom,
    width: rectCanvas.width,
    height: rectCanvas.height,
  };

  images.forEach((img) => {
    // 跳过未就绪的图片，避免绘制空白或抛错
    if (img.complete && img.naturalWidth === 0) return;

    const rectImg = img.getBoundingClientRect();
    const imgRect = {
      left: rectImg.left,
      top: rectImg.top,
      right: rectImg.right,
      bottom: rectImg.bottom,
      width: rectImg.width,
      height: rectImg.height,
    };

    const draw = computeDrawRect(
      canvasRect,
      imgRect,
      drawCanvas.width,
      drawCanvas.height,
    );
    if (draw) {
      try {
        ctx.drawImage(img, draw.x, draw.y, draw.w, draw.h);
      } catch (e) {
        // 单张图片绘制失败（如画布被污染）不阻断整体导出
        console.error("插图合并失败，跳过该图片:", img.src, e);
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
  images: HTMLImageElement[],
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

      // 烘焙为 base64（不强制等待解码，交给合并阶段容错处理）
      img.src = base64Data;
    } catch (err) {
      console.error("图片烘焙失败，保留原地址:", originalSrc, err);
    }
  }
  return originalSources;
}

/**
 * 等待图片完成解码（用于 drawImage 前保证图片可绘制）。
 * 优先使用 img.decode()，兼容降级到 onload/onerror。
 */
export function waitForImageLoad(img: HTMLImageElement): Promise<void> {
  // 已自然宽度 > 0 且完整，说明已加载完成
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve();
  }

  if (typeof img.decode === "function") {
    return img.decode().catch(() => {
      // decode 失败（如损坏图片），退化为等待 load 事件
      return waitForImageEvent(img);
    });
  }

  return waitForImageEvent(img);
}

function waitForImageEvent(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

/** 还原图片的原始 src 地址 */
export function restoreImageSources(
  sources: { el: HTMLImageElement; src: string }[],
): void {
  sources.forEach((item) => {
    item.el.src = item.src;
  });
}

/**
 * 创建带缓存的图片烘焙器。
 *
 * 在分段截图场景下，相邻分段常包含同一张插图。若每次都 fetch + FileReader，
 * 会产生大量重复网络与解码开销。此工厂以"原始 src"为键缓存 base64 结果，
 * 同一张图只 fetch 一次，后续分段直接复用。
 */
export function createCachedImageBaker(): (
  images: HTMLImageElement[],
) => Promise<{ el: HTMLImageElement; src: string }[]> {
  const cache = new Map<string, string>();

  return async (images) => {
    const originalSources: { el: HTMLImageElement; src: string }[] = [];

    for (const img of images) {
      const originalSrc = img.src;
      originalSources.push({ el: img, src: originalSrc });

      if (originalSrc.indexOf("data:") === 0) {
        continue;
      }

      // 命中缓存：直接复用 base64，无需再次 fetch
      const cached = cache.get(originalSrc);
      if (cached) {
        img.src = cached;
        continue;
      }

      try {
        const response = await fetch(originalSrc);
        if (!response.ok) throw new Error("Fetch failed");

        const blob = await response.blob();
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        // 写入缓存并应用
        cache.set(originalSrc, base64Data);
        img.src = base64Data;
      } catch (err) {
        console.error("图片烘焙失败，保留原地址:", originalSrc, err);
      }
    }
    return originalSources;
  };
}
