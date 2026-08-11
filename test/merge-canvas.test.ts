import { describe, it, expect, vi } from "vitest";
import { getMergedCanvasDataUrl, mergeImagesToCanvas } from "../src/capture";

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

    const dataUrl = getMergedCanvasDataUrl(refCanvas, [img]);

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
});
