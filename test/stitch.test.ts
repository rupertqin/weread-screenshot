import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stitchFullPage } from "../src/stitch";
import type { AppContext } from "../src/main";

function makeCtx(): AppContext {
  return {
    isRunning: true,
    config: {
      nextSelector: "",
      chapterSelector: "",
      targetSelector: "",
      delay: 0,
      engineMode: "html2canvas",
    },
    storage: { get: (_k, d) => d, set: () => {} },
    statusEl: null,
  };
}

// happy-dom 的 canvas.getContext("2d") 返回 null，这里给所有 canvas 打桩
let originalCreate: typeof document.createElement;
let drawSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalCreate = document.createElement.bind(document);
  drawSpy = vi.fn();
  vi.spyOn(document, "createElement").mockImplementation((tagName) => {
    const el = originalCreate(tagName) as HTMLCanvasElement;
    if (tagName === "canvas") {
      (el as unknown as { getContext: unknown }).getContext = vi.fn(() => ({
        drawImage: drawSpy,
        toDataURL: () => "data:image/png;base64,AAA",
      }));
    }
    return el;
  });
  // mock 全局滚动
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("stitchFullPage - 分段滚动截图拼接", () => {
  it("内容高度不足一屏时，只截图一次并拼接", async () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollHeight", { value: 500 });
    target.getBoundingClientRect = () =>
      ({ width: 800, left: 0, top: 0, right: 800, bottom: 500, height: 500 }) as DOMRect;

    const html2canvasMock = vi.fn(async () => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 500;
      return c;
    });

    const result = await stitchFullPage(
      makeCtx(),
      html2canvasMock,
      { target, viewportHeight: 800, overlapRatio: 0.2, renderDelay: 0 },
    );

    expect(html2canvasMock).toHaveBeenCalledTimes(1);
    expect(result.height).toBe(500);
    expect(result.width).toBe(800);
  });

  it("高内容分多段滚动，最后拼接画布高度等于内容总高度", async () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollHeight", { value: 3000 });
    target.getBoundingClientRect = () =>
      ({ width: 800, left: 0, top: 0, right: 800, bottom: 3000, height: 3000 }) as DOMRect;

    const viewport = 800;
    const overlap = 0.2;
    // 每段返回高度 = 视口高度
    const html2canvasMock = vi.fn(async () => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = viewport;
      return c;
    });

    const result = await stitchFullPage(
      makeCtx(),
      html2canvasMock,
      { target, viewportHeight: viewport, overlapRatio: overlap, renderDelay: 0 },
    );

    // 最终拼接画布高度 = 内容总高度
    expect(result.height).toBe(3000);
    // 截图次数应 > 1（多段）
    expect(html2canvasMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("每段 html2canvas 收到正确的 scrollY 滚动偏移", async () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollHeight", { value: 2000 });
    target.getBoundingClientRect = () =>
      ({ width: 800, left: 0, top: 0, right: 800, bottom: 2000, height: 2000 }) as DOMRect;

    const viewport = 800;
    const overlap = 0.2;
    const step = Math.max(viewport * (1 - overlap), 1); // 640

    // 通过被 mock 的 window.scrollTo 记录每段滚动偏移
    const scrollOffsets: number[] = [];
    vi.stubGlobal(
      "scrollTo",
      vi.fn((_x: number, y: number) => {
        scrollOffsets.push(y);
      }),
    );

    const html2canvasMock = vi.fn(async () => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = viewport;
      return c;
    });

    await stitchFullPage(
      makeCtx(),
      html2canvasMock,
      { target, viewportHeight: viewport, overlapRatio: overlap, renderDelay: 0 },
    );

    // 校验滚动偏移：0, step, step*2 ... 直到覆盖总高度
    // 注意：stitchFullPage 结束时还会调用一次 scrollTo 恢复原位，需排除该调用
    const captureOffsets = scrollOffsets.slice(0, scrollOffsets.length - 1);
    expect(captureOffsets[0]).toBe(0);
    for (let i = 1; i < captureOffsets.length; i++) {
      expect(captureOffsets[i] - captureOffsets[i - 1]).toBeCloseTo(step);
    }
    // 最后一段应覆盖到内容底部附近
    expect(captureOffsets[captureOffsets.length - 1] + viewport).toBeGreaterThanOrEqual(2000);
  });

  it("任务停止时抛错终止拼接", async () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollHeight", { value: 5000 });
    target.getBoundingClientRect = () =>
      ({ width: 800, left: 0, top: 0, right: 800, bottom: 5000, height: 5000 }) as DOMRect;

    const ctx = makeCtx();
    const html2canvasMock = vi.fn(async () => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 800;
      return c;
    });

    // 第一次 onProgress 后停止任务
    const promise = stitchFullPage(
      ctx,
      html2canvasMock,
      { target, viewportHeight: 800, overlapRatio: 0.2, renderDelay: 0 },
      () => {
        ctx.isRunning = false;
      },
    );

    await expect(promise).rejects.toThrow("任务已停止");
  });

  it("每段渲染前调用 beforeCapture，渲染后调用 afterCapture 还原", async () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollHeight", { value: 1600 });
    target.getBoundingClientRect = () =>
      ({ width: 800, left: 0, top: 0, right: 800, bottom: 1600, height: 1600 }) as DOMRect;

    const beforeCalls: number[] = [];
    const afterCalls: unknown[] = [];
    const html2canvasMock = vi.fn(async () => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 800;
      return c;
    });

    await stitchFullPage(
      makeCtx(),
      html2canvasMock,
      {
        target,
        viewportHeight: 800,
        overlapRatio: 0.2,
        renderDelay: 0,
        beforeCapture: async (y) => {
          beforeCalls.push(y);
          return { baked: y };
        },
        afterCapture: (payload) => {
          afterCalls.push(payload);
        },
      },
    );

    expect(beforeCalls.length).toBeGreaterThan(0);
    expect(beforeCalls[0]).toBe(0);
    // afterCapture 次数应与 beforeCapture 一致
    expect(afterCalls.length).toBe(beforeCalls.length);
    // 渲染次数 == beforeCapture 次数
    expect(html2canvasMock.mock.calls.length).toBe(beforeCalls.length);
  });

  it("强制 scale:1，使 canvas 像素与滚动偏移直接对应", async () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollHeight", { value: 1000 });
    target.getBoundingClientRect = () =>
      ({ width: 800, left: 0, top: 0, right: 800, bottom: 1000, height: 1000 }) as DOMRect;

    const optionsList: Record<string, unknown>[] = [];
    const html2canvasMock = vi.fn(async (_el: unknown, options?: Record<string, unknown>) => {
      optionsList.push(options ?? {});
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 1000;
      return c;
    });

    await stitchFullPage(
      makeCtx(),
      html2canvasMock,
      { target, viewportHeight: 800, overlapRatio: 0.2, renderDelay: 0 },
    );

    expect(optionsList.length).toBeGreaterThan(0);
    // 每段都必须强制 scale:1
    optionsList.forEach((o) => expect(o.scale).toBe(1));
  });

  it("每段可见区域按 currentY 偏移复制到底板（源 y = 目标 y）", async () => {
    const target = document.createElement("div");
    Object.defineProperty(target, "scrollHeight", { value: 2400 });
    target.getBoundingClientRect = () =>
      ({ width: 800, left: 0, top: 0, right: 800, bottom: 2400, height: 2400 }) as DOMRect;

    const html2canvasMock = vi.fn(async () => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 2400; // 全文高度
      return c;
    });

    await stitchFullPage(
      makeCtx(),
      html2canvasMock,
      { target, viewportHeight: 800, overlapRatio: 0.2, renderDelay: 0 },
    );

    // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
    // 可见区域复制：源 y(call[2]) == 目标 y(call[6])，源宽(call[3]) == 目标宽(call[7])
    const segmentCalls = drawSpy.mock.calls;
    expect(segmentCalls.length).toBeGreaterThan(0);
    segmentCalls.forEach((call) => {
      const srcX = call[1];
      const srcY = call[2];
      const srcW = call[3];
      const destX = call[5];
      const destY = call[6];
      const destW = call[7];
      expect(srcX).toBe(destX);
      expect(srcY).toBe(destY);
      expect(srcW).toBe(destW);
    });
  });
});
