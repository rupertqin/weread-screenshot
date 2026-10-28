/**
 * 插图加载模块。
 *
 * 把 `image-fetch.ts` 拿到的字节，转成「可安全绘制到 canvas 的对象」或 base64，
 * 并负责多图并发调度。
 *
 * 为什么需要「可安全绘制的副本」：页面里的 <img> 没有 crossOrigin 属性，
 * 属于 no-cors 加载，直接 drawImage 会污染画布（toDataURL 抛 SecurityError）。
 */

import { fetchImageBlob, isGMAvailable } from "./image-fetch";

/**
 * 可绘制图片：把"页面中的原图（用于定位）"和"可安全绘制到 canvas 的图"分开。
 */
export interface DrawableImage {
  /** 页面中的原始 <img>，仅用于 getBoundingClientRect 定位 */
  el: HTMLImageElement;
  /** 可安全绘制到 canvas 的图片（ImageBitmap / CORS 加载 / base64） */
  img: HTMLImageElement | ImageBitmap;
}

/**
 * 是否为 ImageBitmap（由 blob 创建，绘制时绝不污染画布）。
 *
 * 用鸭子类型而非 instanceof：油猴沙箱与页面可能处于不同 realm，
 * instanceof 跨 realm 会失效。
 */
function isImageBitmap(v: unknown): v is ImageBitmap {
  if (typeof v !== "object" || v === null) return false;
  const candidate = v as ImageBitmap & { src?: unknown };
  return (
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.src === "undefined" &&
    typeof candidate.close === "function"
  );
}

/** 判断一张图是否可安全绘制（不会污染画布） */
export function isSafeToDraw(img: HTMLImageElement | ImageBitmap): boolean {
  // ImageBitmap 来自 Blob，同源数据，永远安全
  if (isImageBitmap(img)) {
    return img.width > 0 && img.height > 0;
  }
  if (!img.complete || img.naturalWidth === 0) return false;
  return img.src.indexOf("data:") === 0 || img.crossOrigin === "anonymous";
}

/**
 * 用 CORS 模式独立加载图片（创建新 Image，不修改页面 DOM）。
 *
 * 微信读书图片 CDN 支持 CORS（返回 Access-Control-Allow-Origin: https://weread.qq.com），
 * 且每次请求服务端都会 302 下发新的短时效签名，因此浏览器原生加载最可靠。
 */
function loadImageWithCORS(
  src: string,
  timeoutMs = 8000,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error("CORS 图片加载超时"));
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("CORS 图片加载失败"));
    };

    img.src = src;
  });
}

/** Blob → dataURL */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 把图片 URL 转成"可安全绘制到 canvas"的对象。
 *
 * 微信读书插图 CDN 的真实行为（实测）：
 *   - 302 重定向到腾讯云 COS，附带约 10 分钟有效的签名；
 *   - 最终响应带 `Content-Disposition: attachment`（浏览器直开地址会下载，但 <img> 显示不受影响）；
 *   - CORS 仅对 Origin: weread.qq.com 白名单放行。
 *
 * 因此最可靠的做法是 **取字节 → createImageBitmap**：
 * Blob 属于同源数据，绘制时绝不会污染画布，完全绕开 CORS 判定与签名时效。
 * 失败再依次降级：Blob → dataURL → Image、CORS 直接加载。
 */
async function srcToDrawable(
  src: string,
  fetchFn?: typeof fetch,
  corsTimeoutMs?: number,
): Promise<HTMLImageElement | ImageBitmap | null> {
  // 1) 取二进制（GM_xmlhttpRequest 优先）→ ImageBitmap（绝对不污染画布）
  try {
    const blob = await fetchImageBlob(src, fetchFn);

    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return bitmap;
      }
    }

    // 2) Blob → dataURL → Image（环境不支持 createImageBitmap 时）
    const dataUrl = await blobToDataUrl(blob);
    return await loadImageWithCORS(dataUrl, corsTimeoutMs);
  } catch (err) {
    console.warn("[插图] 取图失败，尝试 CORS 直接加载:", src, err);
  }

  // 3) CORS 方式直接加载（浏览器原生跟随 302 拿新签名）
  try {
    return await loadImageWithCORS(src, corsTimeoutMs);
  } catch (err) {
    console.error("[插图] 所有加载方式均失败，跳过该图片:", src, err);
    return null;
  }
}

/** 取图并发上限：兼顾速度，又不至于一次打太多请求 */
const IMAGE_FETCH_CONCURRENCY = 4;

/**
 * 受限并发地处理一组任务，结果顺序与入参顺序一致。
 *
 * 用「共享游标 + N 个 worker」实现：每个 worker 取下一个索引执行，
 * 因此任意时刻最多只有 `limit` 个任务在进行中。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };

  const workerCount = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => run()));

  return results;
}

/**
 * 为一批页面插图准备"可绘制副本"（Canvas 引擎用）。
 *
 * 多张图**受限并发**获取（默认 4 路），相比串行显著缩短等待时间；
 * 同一 URL 的重复图片会复用同一个进行中的请求。
 *
 * 任何一张图失败只跳过该图，不阻断整体导出。
 *
 * @param fetchFn       注入 fetch（测试用）
 * @param corsTimeoutMs CORS 兜底加载的超时（测试可传极小值）
 */
export async function prepareDrawableImages(
  images: HTMLImageElement[],
  fetchFn?: typeof fetch,
  corsTimeoutMs?: number,
): Promise<DrawableImage[]> {
  if (!fetchFn) {
    console.log(
      `[插图] 取图通道：GM_xmlhttpRequest=${
        isGMAvailable() ? "可用" : "不可用"
      }，createImageBitmap=${
        typeof createImageBitmap === "function" ? "可用" : "不可用"
      }，并发=${IMAGE_FETCH_CONCURRENCY}`,
    );
  }

  const candidates = images.filter((el) => !!el.src);

  const prepared = await mapWithConcurrency(
    candidates,
    IMAGE_FETCH_CONCURRENCY,
    async (el): Promise<DrawableImage | null> => {
      const src = el.src;

      // 已是 data:，直接复用
      if (src.indexOf("data:") === 0) {
        return { el, img: el };
      }

      const drawable = await srcToDrawable(src, fetchFn, corsTimeoutMs);
      return drawable ? { el, img: drawable } : null;
    },
  );

  const result = prepared.filter(
    (item): item is DrawableImage => item !== null,
  );
  const failed = prepared.length - result.length;

  console.log(
    `[插图] 页面可见插图 ${images.length} 张，成功准备 ${result.length} 张，失败 ${failed} 张`,
  );

  return result;
}

/** 取图片字节并转成 dataURL（html2canvas 需要非跨域的 src） */
async function srcToBase64(
  src: string,
  fetchFn?: typeof fetch,
): Promise<string> {
  const blob = await fetchImageBlob(src, fetchFn);
  return blobToDataUrl(blob);
}

/**
 * 就地烘焙一次：把图片 src 换成 base64，并返回原始 src 以便还原。
 *
 * 不做跨调用缓存（需要缓存时用 {@link createCachedImageBaker}）。
 */
export function bakeImagesToBase64(
  images: HTMLImageElement[],
  fetchFn?: typeof fetch,
): Promise<{ el: HTMLImageElement; src: string }[]> {
  return createCachedImageBaker(fetchFn)(images);
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
 * 在分段截图场景下，相邻分段常包含同一张插图。若每次都重新拉取并转码，
 * 会产生大量重复网络与解码开销。此工厂以"原始 src"为键缓存 base64 结果，
 * 同一张图只处理一次，后续分段直接复用。
 *
 * @param fetchFn 注入 fetch（测试用）
 */
export function createCachedImageBaker(fetchFn?: typeof fetch): (
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

      // 命中缓存：直接复用 base64，无需再次拉取
      const cached = cache.get(originalSrc);
      if (cached) {
        img.src = cached;
        continue;
      }

      try {
        const base64Data = await srcToBase64(originalSrc, fetchFn);
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
