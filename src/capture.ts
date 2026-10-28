/**
 * 核心截图逻辑模块：双引擎导出 + 插图烘焙 + 画布合并
 */

import { computeDrawRect } from "./merge";

/**
 * 带超时的 fetch（浏览器原生，受 CORS 约束）。
 *
 * 注意：在部分环境（代理、严格 CORS、签名重定向）下这个请求会被浏览器
 * 直接 canceled，因此它只作为兜底，首选 {@link gmRequestBlob}。
 */
async function fetchWithTimeout(
  url: RequestInfo | URL,
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      credentials: "include",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取到 GM_xmlhttpRequest 函数（多位置探测，兼容沙箱与无沙箱）。
 */
function getGMRequest(): typeof GM_xmlhttpRequest | null {
  if (typeof GM_xmlhttpRequest === "function") return GM_xmlhttpRequest;

  const candidates: unknown[] = [];
  try {
    candidates.push((window as unknown as Record<string, unknown>).GM_xmlhttpRequest);
  } catch {
    /* ignore */
  }
  try {
    candidates.push(
      (globalThis as unknown as Record<string, unknown>).GM_xmlhttpRequest,
    );
  } catch {
    /* ignore */
  }

  for (const fn of candidates) {
    if (typeof fn === "function") return fn as typeof GM_xmlhttpRequest;
  }
  return null;
}

/** 从响应头字符串里取 content-type */
function parseContentType(headers: string | undefined): string {
  if (!headers) return "";
  const match = /content-type:\s*([^\r\n;]+)/i.exec(headers);
  return match ? match[1].trim() : "";
}

/** 从响应头字符串里取 location（重定向目标） */
function parseLocation(headers: string | undefined): string | null {
  if (!headers) return null;
  const match = /(?:^|[\r\n])location:\s*([^\r\n]+)/i.exec(headers);
  return match ? match[1].trim() : null;
}

interface GMResponseLike {
  status: number;
  response: ArrayBuffer | null;
  responseHeaders?: string;
}

/** 发起一次 GM_xmlhttpRequest（可指定是否手动处理重定向） */
function gmOnce(
  gm: typeof GM_xmlhttpRequest,
  url: string,
  timeoutMs: number,
  redirect: "follow" | "manual",
): Promise<GMResponseLike> {
  type GMCallbackRes = {
    status: number;
    response?: unknown;
    responseHeaders?: string;
    error?: string;
  };

  return new Promise<GMResponseLike>((resolve, reject) => {
    try {
      gm({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: timeoutMs,
        // redirect 在部分管理器上可能不支持，被忽略时退化为 follow
        redirect,
        onload: (res: GMCallbackRes) =>
          resolve({
            status: res.status,
            response: (res.response as ArrayBuffer) ?? null,
            responseHeaders: res.responseHeaders,
          }),
        onerror: (res: GMCallbackRes) =>
          reject(new Error(`网络错误 ${res?.error || ""}`.trim())),
        ontimeout: () => reject(new Error("超时")),
        onabort: () => reject(new Error("已中止")),
      } as never);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * 用 GM_xmlhttpRequest 拉取图片二进制。
 *
 * 微信读书插图的实际链路是：
 *   res.weread.qq.com/wrepub/xxx.jpg  →302→  wrco-xxxx.sh.gfp.tencent-cloud.com/...?sign=...
 *
 * 而脚本管理器（ScriptCat / Tampermonkey）会对**重定向的每一跳单独做 @connect 白名单校验**，
 * 跨域跳转常被拒：
 *   "Request was redirected to a not whitelisted URL"
 * 即使写成 `@connect *` 也可能无效。一旦被拒就只能回退浏览器 fetch，而 fetch 受 CORS 限制必然失败。
 *
 * 因此这里改成**手动处理重定向**：用 `redirect: "manual"` 逐跳请求，自己读 `Location` 再发下一条。
 * 每次请求都是一个独立的一跳请求，不触发管理器的跨域重定向校验。
 *
 * 另外刻意使用 `responseType: "arraybuffer"` 而不是 `"blob"`：
 * 最终响应带 `Content-Disposition: attachment`，某些实现下 blob 会拿到空 response。
 */
async function gmRequestBlob(url: string, timeoutMs = 30000): Promise<Blob> {
  const gmRequest = getGMRequest();
  if (!gmRequest) {
    throw new Error("GM_xmlhttpRequest 不可用（请确认已授予 @grant 与 @connect）");
  }

  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await gmOnce(gmRequest, target, timeoutMs, "manual");

    // 3xx：手动跟一跳
    if (res.status >= 300 && res.status < 400) {
      const location = parseLocation(res.responseHeaders);
      if (!location) {
        throw new Error(`重定向 ${res.status} 但响应缺少 Location`);
      }
      target = new URL(location, target).href;
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }

    const buffer = res.response;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("响应为空（0 字节）");
    }
    const mime = parseContentType(res.responseHeaders) || "image/jpeg";
    return new Blob([buffer], { type: mime });
  }

  throw new Error("重定向次数过多");
}

/**
 * 统一取图：返回图片二进制 Blob。
 *
 * 优先级：注入的 fetch（测试） → GM_xmlhttpRequest（不受 CORS 限制） → 浏览器 fetch。
 */
async function fetchImageBlob(
  src: string,
  fetchFn?: typeof fetch,
): Promise<Blob> {
  // blob:/data: 属于同源资源，浏览器 fetch 即可，且不受 CORS 限制
  if (src.startsWith("blob:") || src.startsWith("data:")) {
    const doFetch = fetchFn ?? fetch;
    const res = await doFetch(src);
    if (!res.ok && res.status !== 0) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }

  // 测试注入：保证行为可预测
  if (fetchFn) {
    const res = await fetchFn(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }

  // 1) GM_xmlhttpRequest：跨域首选（不受 CORS 限制）
  //    图片请求链可能跨多个域名并带重定向，偶发失败时重试一次即可
  let gmError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await gmRequestBlob(src);
    } catch (err) {
      gmError = (err as Error).message;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      console.warn("[插图] GM_xmlhttpRequest 失败：", gmError, src);
    }
  }

  // 2) 浏览器 fetch 兜底（此路径受 CORS 约束，失败会在控制台出现 CORS error）
  try {
    const res = await fetchWithTimeout(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  } catch (err) {
    const fetchError = (err as Error).name === "AbortError"
      ? "请求超时/被取消"
      : (err as Error).message;
    throw new Error(
      `GM 与 fetch 均失败（GM: ${gmError || "未知"}；fetch: ${fetchError}）`,
    );
  }
}

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
 * 可绘制图片：把"页面中的原图（用于定位）"和"可安全绘制到 canvas 的图"分开。
 *
 * 页面里的 <img> 没有 crossOrigin 属性，属于 no-cors 加载，
 * 直接 drawImage 会污染画布（toDataURL 抛 SecurityError）。
 * 因此需要另一个可安全绘制的副本（ImageBitmap 或 base64/CORS 图）。
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
export function loadImageWithCORS(
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
 * 因此最可靠的做法是 **fetch 拿 Blob → createImageBitmap**：
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
    console.warn("[插图] fetch 失败，尝试 CORS 直接加载:", src, err);
  }

  // 3) CORS 方式直接加载（浏览器原生跟随 302 拿新签名）
  try {
    return await loadImageWithCORS(src, corsTimeoutMs);
  } catch (err) {
    console.error("[插图] 所有加载方式均失败，跳过该图片:", src, err);
    return null;
  }
}

/**
 * 为一批页面插图准备"可绘制副本"。
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
  const result: DrawableImage[] = [];
  let failed = 0;

  if (!fetchFn) {
    console.log(
      `[插图] 取图通道：GM_xmlhttpRequest=${
        getGMRequest() ? "可用" : "不可用"
      }，createImageBitmap=${
        typeof createImageBitmap === "function" ? "可用" : "不可用"
      }`,
    );
  }

  for (const el of images) {
    const src = el.src;
    if (!src) continue;

    // 已是 data:，直接复用
    if (src.indexOf("data:") === 0) {
      result.push({ el, img: el });
      continue;
    }

    const drawable = await srcToDrawable(src, fetchFn, corsTimeoutMs);
    if (drawable) {
      result.push({ el, img: drawable });
    } else {
      failed += 1;
    }
  }

  console.log(
    `[插图] 页面可见插图 ${images.length} 张，成功准备 ${result.length} 张，失败 ${failed} 张`,
  );

  return result;
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
  const rectCanvas = refCanvas.getBoundingClientRect();
  const canvasRect = {
    left: rectCanvas.left,
    top: rectCanvas.top,
    right: rectCanvas.right,
    bottom: rectCanvas.bottom,
    width: rectCanvas.width,
    height: rectCanvas.height,
  };

  images.forEach((input) => {
    // 统一成 { el: 用于定位, img: 用于绘制 }
    const item: DrawableImage =
      "el" in input ? input : { el: input, img: input };
    const { el, img } = item;

    // 跳过不可安全绘制的图片，避免污染画布导致 toDataURL 抛 SecurityError
    if (!isSafeToDraw(img)) return;

    const rectImg = el.getBoundingClientRect();
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

/**
 * 把图片 URL 转成 base64 数据。
 *
 * 优先用 CORS 方式加载图片再经 canvas 导出：
 * 微信读书图片走 302 重定向到带「短时效签名」的 COS 地址（签名约 10 分钟过期），
 * 直接 fetch 旧地址会 401；而浏览器以 <img> 方式加载时会自行跟随 302 拿新签名，
 * 因此 CORS 加载最可靠。失败时回退到 fetch + FileReader。
 *
 * @param allowCORS 为 false 时只走 fetch（便于测试注入 fetch mock）
 */
async function srcToBase64(
  src: string,
  fetchFn?: typeof fetch,
): Promise<string> {
  // 取到字节后直接转 dataURL：属于同源数据，html2canvas 读取时不会跨域
  const blob = await fetchImageBlob(src, fetchFn);
  return blobToDataUrl(blob);
}

/**
 * 追踪图片 302 重定向并就地烘焙成 Base64
 * 返回原始 src 列表，便于之后还原。
 */
export async function bakeImagesToBase64(
  images: HTMLImageElement[],
  fetchFn?: typeof fetch,
): Promise<{ el: HTMLImageElement; src: string }[]> {
  const originalSources: { el: HTMLImageElement; src: string }[] = [];

  for (const img of images) {
    const originalSrc = img.src;
    originalSources.push({ el: img, src: originalSrc });

    if (originalSrc.indexOf("data:") === 0) {
      continue;
    }

    try {
      // 注入了 fetchFn（测试场景）时只走 fetch，保证行为可预测
      const base64Data = await srcToBase64(originalSrc, fetchFn);
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
 * 在分段截图场景下，相邻分段常包含同一张插图。若每次都重新拉取并转码，
 * 会产生大量重复网络与解码开销。此工厂以"原始 src"为键缓存 base64 结果，
 * 同一张图只处理一次，后续分段直接复用。
 *
 * @param fetchFn 注入 fetch（测试用）。提供时只走 fetch，不走 CORS。
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
