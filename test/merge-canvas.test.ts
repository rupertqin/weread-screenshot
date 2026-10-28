import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getMergedCanvasExport,
  mergeImagesToCanvas,
  encodeCanvas,
  WEBP_QUALITY,
} from "../src/canvas-ops";
import {
  isSafeToDraw,
  prepareDrawableImages,
} from "../src/image-load";
import { clearImageBlobCache } from "../src/image-fetch";

/** 创建一个带 mock 2d context 的 canvas，可记录 drawImage 调用 */
function makeMockCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  drawSpy: ReturnType<typeof vi.fn>;
  getContext: ReturnType<typeof vi.fn>;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const drawSpy = vi.fn();
  const getContext = vi.fn(() => ({ drawImage: drawSpy }));
  (canvas as unknown as { getContext: unknown }).getContext = getContext;
  return { canvas, drawSpy, getContext };
}

describe("getMergedCanvasDataUrl - 克隆合并使用参考画布几何", () => {
  it("使用仍在 DOM 中的参考画布 rect 计算坐标，而非克隆画布", () => {
    const { canvas: refCanvas } = makeMockCanvas(1600, 1200);
    refCanvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // 插图：视口位置 (100,100)，大小 100x100，与参考画布重叠
    const img = new Image();
    img.src = "data:image/png;base64,AAAA"; // 已烘焙，避免被跨域过滤跳过
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 50 });
    img.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 100,
        right: 200,
        bottom: 200,
        width: 100,
        height: 100,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;

    // spy 克隆画布的 drawImage，验证坐标
    let cloneDrawSpy: ReturnType<typeof vi.fn> | null = null;
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const el = originalCreate(tagName) as HTMLCanvasElement;
      if (tagName === "canvas") {
        el.width = 1600;
        el.height = 1200;
        cloneDrawSpy = vi.fn();
        (el as unknown as { getContext: unknown }).getContext = vi.fn(() => ({
          drawImage: cloneDrawSpy,
        }));
      }
      return el;
    });

    const { dataUrl } = getMergedCanvasExport(refCanvas, [img], "png");

    expect(cloneDrawSpy).not.toBeNull();
    // 第一个调用克隆原画布；第二个调用是插图
    // 插图坐标：scaleX=1600/800=2, scaleY=1200/600=2
    // x=(100-0)*2=200, y=(100-0)*2=200, w=100*2=200, h=100*2=200
    expect(cloneDrawSpy!.mock.calls[1]).toEqual([img, 200, 200, 200, 200]);
    expect(typeof dataUrl).toBe("string");

    vi.restoreAllMocks();
  });
});

describe("mergeImagesToCanvas - 参考画布与克隆画布分离", () => {
  it("克隆画布 getBoundingClientRect 为全 0 时，仍以参考画布定位", () => {
    const { canvas: clone, drawSpy } = makeMockCanvas(800, 600);
    const { canvas: refCanvas } = makeMockCanvas(800, 600);
    refCanvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const img = new Image();
    img.src = "data:image/png;base64,AAAA"; // 已烘焙，避免被跨域过滤跳过
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 20 });
    img.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 0,
        right: 200,
        bottom: 100,
        width: 100,
        height: 100,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    mergeImagesToCanvas(clone, refCanvas, [img]);

    // 参考画布 scaleX = 800/400 = 2, scaleY = 600/300 = 2
    // x=(100-0)*2=200, y=0, w=100*2=200, h=100*2=200
    expect(drawSpy).toHaveBeenCalledWith(img, 200, 0, 200, 200);
  });

  it("未烘焙（跨域原始 src）的图片被跳过，避免污染画布", () => {
    const { canvas: clone, drawSpy } = makeMockCanvas(800, 600);
    const { canvas: refCanvas } = makeMockCanvas(800, 600);
    refCanvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // 跨域原图（非 data:），模拟烘焙失败后保留的原始 src
    const crossOriginImg = new Image();
    crossOriginImg.src = "https://cdn.example.com/img.png";
    Object.defineProperty(crossOriginImg, "complete", { value: true });
    Object.defineProperty(crossOriginImg, "naturalWidth", { value: 20 });
    crossOriginImg.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 0,
        right: 200,
        bottom: 100,
        width: 100,
        height: 100,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    mergeImagesToCanvas(clone, refCanvas, [crossOriginImg]);

    // 跨域图不应被 drawImage，避免画布污染
    expect(drawSpy).not.toHaveBeenCalled();
  });
});

describe("isSafeToDraw - 可安全绘制判定", () => {
  function makeImg(opts: {
    src: string;
    complete?: boolean;
    naturalWidth?: number;
    crossOrigin?: string | null;
  }): HTMLImageElement {
    const img = new Image();
    img.src = opts.src;
    if (opts.crossOrigin !== undefined && opts.crossOrigin !== null) {
      img.crossOrigin = opts.crossOrigin;
    }
    Object.defineProperty(img, "complete", { value: opts.complete ?? true });
    Object.defineProperty(img, "naturalWidth", {
      value: opts.naturalWidth ?? 100,
    });
    return img;
  }

  it("data: 图片且已加载 → 可安全绘制", () => {
    expect(
      isSafeToDraw(makeImg({ src: "data:image/png;base64,AAAA" })),
    ).toBe(true);
  });

  it("CORS 模式加载的跨域图 → 可安全绘制", () => {
    expect(
      isSafeToDraw(
        makeImg({
          src: "https://res.weread.qq.com/a.jpg",
          crossOrigin: "anonymous",
        }),
      ),
    ).toBe(true);
  });

  it("普通跨域图（无 crossOrigin）→ 不可绘制，避免污染画布", () => {
    expect(
      isSafeToDraw(makeImg({ src: "https://res.weread.qq.com/a.jpg" })),
    ).toBe(false);
  });

  it("未加载完成（naturalWidth=0）→ 不可绘制", () => {
    expect(
      isSafeToDraw(
        makeImg({
          src: "data:image/png;base64,AAAA",
          naturalWidth: 0,
        }),
      ),
    ).toBe(false);
  });
});

describe("prepareDrawableImages - fetch → ImageBitmap 路径", () => {
  beforeEach(() => {
    // 会话缓存是模块级状态，逐用例清空避免互相干扰
    clearImageBlobCache();
  });

  it("fetch 成功时用 createImageBitmap 生成可安全绘制的位图", async () => {
    const el = new Image();
    el.src = "https://res.weread.qq.com/a.jpg";

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => blob,
    })) as unknown as typeof fetch;

    // 模拟浏览器 createImageBitmap
    const fakeBitmap = {
      width: 823,
      height: 973,
      close: () => {},
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => fakeBitmap),
    );

    const result = await prepareDrawableImages([el], fetchMock);

    expect(result.length).toBe(1);
    expect(result[0].el).toBe(el);
    // 拿到的是位图，且判定为可安全绘制
    expect(isSafeToDraw(result[0].img)).toBe(true);

    vi.unstubAllGlobals();
  });

  it("优先用 GM_xmlhttpRequest 取 arraybuffer 并自行组 Blob", async () => {
    const el = new Image();
    el.src = "https://res.weread.qq.com/a.jpg";

    const buffer = new Uint8Array([7, 7, 7]).buffer;
    const gmSpy = vi.fn(
      (details: {
        url?: string;
        responseType?: string;
        onload?: (res: {
          status: number;
          response: ArrayBuffer;
          responseHeaders: string;
        }) => void;
      }) => {
        details.onload?.({
          status: 200,
          response: buffer,
          responseHeaders:
            "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Disposition: attachment\r\n",
        });
      },
    );
    vi.stubGlobal("GM_xmlhttpRequest", gmSpy);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 100, height: 120, close: () => {} })),
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await prepareDrawableImages([el]);

    expect(gmSpy).toHaveBeenCalledTimes(1);
    const details = gmSpy.mock.calls[0][0];
    expect(details.url).toBe("https://res.weread.qq.com/a.jpg");
    // 必须用 arraybuffer（blob 在 Content-Disposition: attachment 响应下可能为空）
    expect(details.responseType).toBe("arraybuffer");
    expect(result.length).toBe(1);
    expect(isSafeToDraw(result[0].img)).toBe(true);

    consoleLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("默认一次请求交给管理器自动跟随重定向（最快路径）", async () => {
    const el = new Image();
    el.src = "https://res.weread.qq.com/wrepub/a.jpg";

    const calls: { url: string; redirect?: string }[] = [];
    const gmSpy = vi.fn(
      (details: {
        url: string;
        redirect?: string;
        onload?: (res: {
          status: number;
          response: ArrayBuffer | null;
          responseHeaders: string;
        }) => void;
      }) => {
        calls.push({ url: details.url, redirect: details.redirect });
        details.onload?.({
          status: 200,
          response: new Uint8Array([1, 2, 3, 4]).buffer,
          responseHeaders: "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\n",
        });
      },
    );
    vi.stubGlobal("GM_xmlhttpRequest", gmSpy);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 10, height: 10, close: () => {} })),
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await prepareDrawableImages([el]);

    // 自动跟随成功：只发一次请求
    expect(calls.length).toBe(1);
    expect(calls[0].redirect).toBe("follow");
    expect(result.length).toBe(1);
    expect(isSafeToDraw(result[0].img)).toBe(true);

    consoleLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("自动跟随被拦（网络层错误）时回退手动逐跳，仍能拿到图", async () => {
    const original = "https://res.weread.qq.com/wrepub/b.jpg";
    const cosUrl =
      "https://wrco-40036.sh.gfp.tencent-cloud.com/CB_1/wrk_abc.jpg?sign=xyz";

    const el = new Image();
    el.src = original;

    const calls: { url: string; redirect?: string }[] = [];
    const gmSpy = vi.fn(
      (details: {
        url: string;
        redirect?: string;
        onload?: (res: {
          status: number;
          response: ArrayBuffer | null;
          responseHeaders: string;
        }) => void;
        onerror?: (res: { status: number; error: string }) => void;
      }) => {
        calls.push({ url: details.url, redirect: details.redirect });

        // 自动跟随这一跳被管理器的跨域重定向白名单拒绝
        if (details.redirect === "follow") {
          details.onerror?.({
            status: 0,
            error: "Refused to connect: redirected to a not whitelisted URL",
          });
          return;
        }

        // 手动逐跳：原地址返回 302 + Location
        if (details.url === original) {
          details.onload?.({
            status: 302,
            response: null,
            responseHeaders: `HTTP/1.1 302 Found\r\nLocation: ${cosUrl}\r\n`,
          });
          return;
        }

        // 第二跳拿到图片
        details.onload?.({
          status: 200,
          response: new Uint8Array([1, 2, 3, 4]).buffer,
          responseHeaders: "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\n",
        });
      },
    );
    vi.stubGlobal("GM_xmlhttpRequest", gmSpy);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 10, height: 10, close: () => {} })),
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await prepareDrawableImages([el]);

    // 第 1 次自动跟随，失败后回退两次手动逐跳
    expect(calls.length).toBe(3);
    expect(calls[0].redirect).toBe("follow");
    expect(calls[1].redirect).toBe("manual");
    expect(calls[1].url).toBe(original);
    expect(calls[2].url).toBe(cosUrl);
    expect(result.length).toBe(1);
    expect(isSafeToDraw(result[0].img)).toBe(true);

    consoleLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("GM 返回空响应属确定性失败：不重试、也不再退回浏览器 fetch", async () => {
    const el = new Image();
    el.src = "https://res.weread.qq.com/empty.jpg";

    const gmSpy = vi.fn(
      (details: {
        onload?: (res: {
          status: number;
          response: ArrayBuffer;
          responseHeaders: string;
        }) => void;
      }) => {
        details.onload?.({
          status: 200,
          response: new ArrayBuffer(0), // 0 字节，确定性失败
          responseHeaders: "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\n",
        });
      },
    );
    vi.stubGlobal("GM_xmlhttpRequest", gmSpy);

    // GM 可用时不应再走浏览器 fetch（该路径必然被 CORS 拦，只会刷错误日志）
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("Failed to fetch"));

    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await prepareDrawableImages([el], undefined, 1);

    // 确定性失败只请求一次
    expect(gmSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    // 跳过该图，但整体不抛错
    expect(result.length).toBe(0);

    fetchSpy.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    consoleLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("多张图受限并发获取，最多 4 路同时进行", async () => {
    const imgs = Array.from({ length: 6 }, (_, i) => {
      const el = new Image();
      el.src = `https://res.weread.qq.com/p${i}.jpg`;
      return el;
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const gmSpy = vi.fn(
      (details: {
        onload?: (res: {
          status: number;
          response: ArrayBuffer;
          responseHeaders: string;
        }) => void;
      }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // 稍作延迟，确保并发窗口能被观测到
        setTimeout(() => {
          inFlight -= 1;
          details.onload?.({
            status: 200,
            response: new Uint8Array([1]).buffer,
            responseHeaders: "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\n",
          });
        }, 5);
      },
    );
    vi.stubGlobal("GM_xmlhttpRequest", gmSpy);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4, height: 4, close: () => {} })),
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await prepareDrawableImages(imgs);

    expect(gmSpy).toHaveBeenCalledTimes(6);
    // 并发上限 4：同时进行的请求不超过 4 路，且确实发生了并发
    expect(maxInFlight).toBe(4);
    // 结果顺序与入参顺序一致
    expect(result.length).toBe(6);
    expect(result[0].el).toBe(imgs[0]);
    expect(result[5].el).toBe(imgs[5]);

    consoleLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("同一 URL 命中会话缓存，不重复发请求", async () => {
    const url = "https://res.weread.qq.com/cached.jpg";

    const gmSpy = vi.fn(
      (details: {
        onload?: (res: {
          status: number;
          response: ArrayBuffer;
          responseHeaders: string;
        }) => void;
      }) => {
        details.onload?.({
          status: 200,
          response: new Uint8Array([1, 2]).buffer,
          responseHeaders: "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\n",
        });
      },
    );
    vi.stubGlobal("GM_xmlhttpRequest", gmSpy);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 8, height: 8, close: () => {} })),
    );

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const a = new Image();
    a.src = url;
    const b = new Image();
    b.src = url;

    const result = await prepareDrawableImages([a, b]);

    // 两张同 URL 的图只应触发一次网络请求
    expect(gmSpy).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(2);

    consoleLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("已是 data: 的图片直接复用原元素，不发起请求", async () => {
    const el = new Image();
    el.src = "data:image/png;base64,AAAA";

    const fetchMock = vi.fn() as unknown as typeof fetch;
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await prepareDrawableImages([el], fetchMock);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.length).toBe(1);
    expect(result[0].img).toBe(el);

    consoleLog.mockRestore();
  });
});

describe("mergeImagesToCanvas - 支持 DrawableImage（CORS 副本）", () => {
  it("用原图 el 定位、用 CORS 副本 img 绘制", () => {
    const { canvas: clone, drawSpy } = makeMockCanvas(800, 600);
    const { canvas: refCanvas } = makeMockCanvas(800, 600);
    refCanvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // 页面里的原图：跨域、仅用于定位
    const el = new Image();
    el.src = "https://res.weread.qq.com/a.jpg";
    el.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 0,
        right: 200,
        bottom: 100,
        width: 100,
        height: 100,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    // CORS 独立加载的可绘制副本
    const corsImg = new Image();
    corsImg.crossOrigin = "anonymous";
    corsImg.src = "https://res.weread.qq.com/a.jpg";
    Object.defineProperty(corsImg, "complete", { value: true });
    Object.defineProperty(corsImg, "naturalWidth", { value: 100 });

    mergeImagesToCanvas(clone, refCanvas, [{ el, img: corsImg }]);

    // 绘制的是 CORS 副本，坐标来自原图 el
    expect(drawSpy).toHaveBeenCalledWith(corsImg, 200, 0, 200, 200);
  });
});

describe("encodeCanvas - 导出格式与扩展名", () => {
  function canvasReturning(dataUrl: string) {
    const canvas = document.createElement("canvas");
    const spy = vi.spyOn(canvas, "toDataURL").mockReturnValue(dataUrl);
    return { canvas, spy };
  }

  it("png：不带质量参数，扩展名 png", () => {
    const { canvas, spy } = canvasReturning("data:image/png;base64,AAA");

    const result = encodeCanvas(canvas, "png");

    expect(spy).toHaveBeenCalledWith("image/png", undefined);
    expect(result.ext).toBe("png");
  });

  it("webp：带质量参数，扩展名 webp", () => {
    const { canvas, spy } = canvasReturning("data:image/webp;base64,AAA");

    const result = encodeCanvas(canvas, "webp");

    expect(spy).toHaveBeenCalledWith("image/webp", WEBP_QUALITY);
    expect(result.ext).toBe("webp");
  });

  it("浏览器不支持 webp（静默回落 PNG）时，扩展名跟随实际格式", () => {
    // 请求 webp 但底层返回 PNG 数据
    const { canvas } = canvasReturning("data:image/png;base64,AAA");

    const result = encodeCanvas(canvas, "webp");

    // 关键：不能把 PNG 内容命名为 .webp
    expect(result.ext).toBe("png");
  });

  it("jpeg 数据统一用 jpg 后缀", () => {
    const { canvas } = canvasReturning("data:image/jpeg;base64,AAA");
    expect(encodeCanvas(canvas, "webp").ext).toBe("jpg");
  });

  it("MIME 解析不出时兜底为 png", () => {
    const { canvas } = canvasReturning("data:text/plain;base64,AAA");
    expect(encodeCanvas(canvas, "webp").ext).toBe("png");
  });
});
