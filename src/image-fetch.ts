/**
 * 插图取字节模块。
 *
 * 只负责「把 URL 变成 Blob」这一件事，包含三条通道：
 *   1. GM_xmlhttpRequest（带 @connect 授权，不受 CORS 限制）——主路径；
 *   2. 其中又分「管理器自动跟随重定向」与「手动逐跳」两种，前者失败自动降级到后者；
 *   3. 浏览器 fetch——仅在没有 GM 通道时兜底。
 *
 * 上层的「把 Blob 变成可绘制对象 / base64」见 image-load.ts。
 */

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

/** 取到 GM_xmlhttpRequest 函数（多位置探测，兼容沙箱与无沙箱） */
function getGMRequest(): typeof GM_xmlhttpRequest | null {
  if (typeof GM_xmlhttpRequest === "function") return GM_xmlhttpRequest;

  const candidates: unknown[] = [];
  try {
    candidates.push(
      (window as unknown as Record<string, unknown>).GM_xmlhttpRequest,
    );
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

/** 当前环境是否有可用的 GM 通道 */
export function isGMAvailable(): boolean {
  return getGMRequest() !== null;
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

/**
 * 取图失败错误。
 *
 * `transient` 标记该错误是否值得重试：
 *   - 网络错误 / 超时 → 抖动，重试有意义；
 *   - HTTP 4xx、缺少 Location、0 字节 → 确定性失败，重试只会浪费一次请求。
 */
class ImageFetchError extends Error {
  readonly transient: boolean;

  constructor(message: string, transient = false) {
    super(message);
    this.name = "ImageFetchError";
    this.transient = transient;
  }
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
          reject(
            new ImageFetchError(`网络错误 ${res?.error || ""}`.trim(), true),
          ),
        ontimeout: () => reject(new ImageFetchError("超时", true)),
        onabort: () => reject(new ImageFetchError("已中止")),
      } as never);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** 取 GM 函数，缺失时抛出统一错误 */
function requireGMRequest(): typeof GM_xmlhttpRequest {
  const gmRequest = getGMRequest();
  if (!gmRequest) {
    throw new ImageFetchError(
      "GM_xmlhttpRequest 不可用（请确认已授予 @grant 与 @connect）",
    );
  }
  return gmRequest;
}

/** 校验 2xx 响应并组装 Blob */
function responseToBlob(res: GMResponseLike): Blob {
  if (res.status < 200 || res.status >= 300) {
    throw new ImageFetchError(`HTTP ${res.status}`);
  }
  const buffer = res.response;
  if (!buffer || buffer.byteLength === 0) {
    throw new ImageFetchError("响应为空（0 字节）");
  }
  const mime = parseContentType(res.responseHeaders) || "image/jpeg";
  return new Blob([buffer], { type: mime });
}

/**
 * 手动逐跳跟随重定向：每次只发一条不跳转的请求。
 *
 * 微信读书插图链路是：
 *   res.weread.qq.com/wrepub/xxx.jpg  →302→  wrco-xxxx.sh.gfp.tencent-cloud.com/...?sign=...
 *
 * 而脚本管理器会对**重定向的每一跳单独做 @connect 白名单校验**，跨域跳转常被拒：
 *   "Request was redirected to a not whitelisted URL"
 * 即使写成 `@connect *` 也可能无效。拆成两次单跳请求后，每次的目标都由我们自己
 * 指定，不存在「跨域跳转」这个动作，校验就不触发。
 */
async function gmRequestBlobManual(
  url: string,
  timeoutMs = 30000,
): Promise<Blob> {
  const gmRequest = requireGMRequest();
  let target = url;

  for (let hop = 0; hop < 5; hop++) {
    const res = await gmOnce(gmRequest, target, timeoutMs, "manual");

    if (res.status < 300 || res.status >= 400) {
      return responseToBlob(res);
    }

    const location = parseLocation(res.responseHeaders);
    if (!location) {
      throw new ImageFetchError(`重定向 ${res.status} 但响应缺少 Location`);
    }
    target = new URL(location, target).href;
  }

  throw new ImageFetchError("重定向次数过多");
}

/** 交给管理器自动跟随重定向（常规路径，一次请求到位） */
async function gmRequestBlobFollow(
  url: string,
  timeoutMs = 30000,
): Promise<Blob> {
  const res = await gmOnce(requireGMRequest(), url, timeoutMs, "follow");
  return responseToBlob(res);
}

/**
 * 取图：优先一次请求让管理器自动跟随重定向；被拦时回退为手动逐跳。
 *
 * 实测「自动跟随」在脚本已获 `@connect` 跨域授权时是可行的，而且只发一次请求，
 * 因此作为主路径。若某个管理器仍会拦截跨域重定向（报 not whitelisted），
 * 再回退到手动逐跳，保证任何环境下都能拿到图。
 *
 * 只有**网络层失败**才回退：`HTTP 4xx`、`0 字节` 这类确定性错误手动跳也不会好，
 * 回退只会白白多打一次请求。
 */
async function gmRequestBlob(url: string, timeoutMs = 30000): Promise<Blob> {
  try {
    return await gmRequestBlobFollow(url, timeoutMs);
  } catch (err) {
    const retryable = err instanceof ImageFetchError ? err.transient : true;
    if (!retryable) throw err;

    try {
      return await gmRequestBlobManual(url, timeoutMs);
    } catch (manualError) {
      throw new ImageFetchError(
        `${(manualError as Error).message}（自动跟随亦失败：${(err as Error).message}）`,
      );
    }
  }
}

/**
 * 会话级图片缓存：同一张图跨页/跨章节只取一次。
 *
 * 存的是 **Promise** 而不是 Blob：并发取图时，同一 URL 的多个请求会复用
 * 同一个进行中的 Promise，既避免重复下载，也避免创建多份 Blob。
 */
const imageBlobCache = new Map<string, Promise<Blob>>();
const IMAGE_BLOB_CACHE_LIMIT = 100;

/** 清空图片缓存（测试用） */
export function clearImageBlobCache(): void {
  imageBlobCache.clear();
}

/** 取图核心逻辑（不含缓存） */
async function loadImageBlob(
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

  // 1) GM_xmlhttpRequest：跨域首选（内部已含「自动跟随 → 手动逐跳」的降级）
  if (getGMRequest()) {
    try {
      return await gmRequestBlob(src);
    } catch (err) {
      const message = (err as Error).message;
      console.warn("[插图] 取图失败：", message, src);
      throw err instanceof ImageFetchError
        ? err
        : new ImageFetchError(message);
    }
  }

  // 2) 无 GM 通道时的浏览器 fetch 兜底（受 CORS 约束）
  const res = await fetchWithTimeout(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * 统一取图：带会话缓存 + 并发去重。
 *
 * 注入 `fetchFn`（测试场景）时不使用缓存，保证用例之间互不干扰。
 */
export function fetchImageBlob(
  src: string,
  fetchFn?: typeof fetch,
): Promise<Blob> {
  if (fetchFn) return loadImageBlob(src, fetchFn);

  const cached = imageBlobCache.get(src);
  if (cached) return cached;

  const task = loadImageBlob(src);
  if (imageBlobCache.size >= IMAGE_BLOB_CACHE_LIMIT) {
    // 简单 FIFO 淘汰，避免长会话内存无限增长
    const oldest = imageBlobCache.keys().next().value;
    if (oldest !== undefined) imageBlobCache.delete(oldest);
  }
  imageBlobCache.set(src, task);

  // 失败不缓存，下次还能重试
  task.catch(() => {
    if (imageBlobCache.get(src) === task) imageBlobCache.delete(src);
  });

  return task;
}
