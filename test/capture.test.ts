import { describe, it, expect, vi } from "vitest";
import { bakeImagesToBase64, restoreImageSources } from "../src/capture";

describe("bakeImagesToBase64 - 302 烘焙", () => {
  it("已为 data: 的图片不重复烘焙，src 保持不变", async () => {
    const img = new Image();
    img.src = "data:image/png;base64,AAAA";

    const fetchMock = vi.fn();
    const sources = await bakeImagesToBase64([img], fetchMock as unknown as typeof fetch);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(img.src).toBe("data:image/png;base64,AAAA");
    expect(sources[0].src).toBe("data:image/png;base64,AAAA");
  });

  it("普通图片烘焙为 base64 并替换 src", async () => {
    const img = new Image();
    img.src = "https://example.com/a.png";

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
    const img = new Image();
    img.src = "https://example.com/fail.png";

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

    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => blob }) as Response);

    const sources = await bakeImagesToBase64([img], fetchMock as unknown as typeof fetch);
    expect(img.src.startsWith("data:")).toBe(true);

    restoreImageSources(sources);
    expect(img.src).toBe("https://example.com/original.png");
  });
});
