import { describe, it, expect, vi } from "vitest";
import {
  bakeImagesToBase64,
  restoreImageSources,
  waitForImageLoad,
} from "../src/capture";

describe("waitForImageLoad - 等待图片解码", () => {
  it("已加载完成的图片立即 resolve", async () => {
    const img = new Image();
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    await expect(waitForImageLoad(img)).resolves.toBeUndefined();
  });

  it("decode 成功时使用 decode 完成", async () => {
    const img = new Image();
    Object.defineProperty(img, "complete", { value: false });
    img.decode = vi.fn(async () => {}) as unknown as () => Promise<void>;
    await expect(waitForImageLoad(img)).resolves.toBeUndefined();
    expect(img.decode).toHaveBeenCalled();
  });

  it("decode 失败时降级为 load 事件", async () => {
    const img = new Image();
    Object.defineProperty(img, "complete", { value: false });
    img.decode = vi.fn(async () => {
      throw new Error("decode failed");
    }) as unknown as () => Promise<void>;

    const promise = waitForImageLoad(img);
    // 等 decode 的 catch 分支注册好 load 监听器后再触发事件
    await new Promise((r) => setTimeout(r, 0));
    img.dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("bakeImagesToBase64 - 302 烘焙", () => {
  // happy-dom 的 Image 默认无 decode，需打桩以避免等待 load 事件导致挂起
  function mockDecodableImage(src: string): HTMLImageElement {
    const img = new Image();
    img.src = src;
    img.decode = vi.fn(async () => {}) as unknown as () => Promise<void>;
    return img;
  }

  it("已为 data: 的图片不重复烘焙，src 保持不变", async () => {
    const img = mockDecodableImage("data:image/png;base64,AAAA");

    const fetchMock = vi.fn();
    const sources = await bakeImagesToBase64([img], fetchMock as unknown as typeof fetch);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(img.src).toBe("data:image/png;base64,AAAA");
    expect(sources[0].src).toBe("data:image/png;base64,AAAA");
  });

  it("普通图片烘焙为 base64 并替换 src", async () => {
    const img = mockDecodableImage("https://example.com/a.png");

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const response = { ok: true, blob: async () => blob } as Response;
    const fetchMock = vi.fn(async () => response);

    const sources = await bakeImagesToBase64([img], fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/a.png");
    // 烘焙后 src 应为 data: 开头
    expect(img.src.startsWith("data:")).toBe(true);
    // 返回原始地址列表，便于还原
    expect(sources[0].src).toBe("https://example.com/a.png");
  });

  it("fetch 失败时保留原始 src，不抛错", async () => {
    const img = mockDecodableImage("https://example.com/fail.png");

    const fetchMock = vi.fn(async () => {
      throw new Error("network error");
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const sources = await bakeImagesToBase64([img], fetchMock as unknown as typeof fetch);

    expect(img.src).toBe("https://example.com/fail.png");
    expect(sources[0].src).toBe("https://example.com/fail.png");
    consoleSpy.mockRestore();
  });
});

describe("restoreImageSources - 还原 src", () => {
  it("把图片的 src 还原为原始地址", async () => {
    const img = new Image();
    img.src = "https://example.com/original.png";
    img.decode = vi.fn(async () => {}) as unknown as () => Promise<void>;

    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }) as Response);

    const sources = await bakeImagesToBase64([img], fetchMock as unknown as typeof fetch);
    expect(img.src.startsWith("data:")).toBe(true);

    restoreImageSources(sources);
    expect(img.src).toBe("https://example.com/original.png");
  });
});
