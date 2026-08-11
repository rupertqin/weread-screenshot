import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  createGMStorage,
  type StorageLike,
} from "../src/config";

describe("createGMStorage - 存储实现", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("无 GM API 时降级为内存存储，get/set 正常工作", () => {
    // happy-dom 环境下没有 GM_getValue/GM_setValue
    const storage = createGMStorage();
    storage.set("key", 42);
    expect(storage.get("key", 0)).toBe(42);
    expect(storage.get("missing", "default")).toBe("default");
  });

  it("存在 GM API 时优先使用 GM_*", () => {
    const getMock = vi.fn((k: string, d: unknown) => d);
    const setMock = vi.fn();
    vi.stubGlobal("GM_getValue", getMock);
    vi.stubGlobal("GM_setValue", setMock);

    const storage = createGMStorage();
    storage.get("a", 1);
    storage.set("b", 2);

    expect(getMock).toHaveBeenCalledWith("a", 1);
    expect(setMock).toHaveBeenCalledWith("b", 2);
  });
});

describe("loadConfig / saveConfig - 配置读写", () => {
  const memStorage: StorageLike = {
    get: (_k, d) => d,
    set: () => {},
  };

  it("loadConfig 返回默认配置（存储为空时）", () => {
    const config = loadConfig(memStorage);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("saveConfig 后 loadConfig 能恢复所存配置", () => {
    const map = new Map<string, unknown>();
    const storage: StorageLike = {
      get: (k, d) => (map.has(k) ? (map.get(k) as never) : d),
      set: (k, v) => {
        map.set(k, v);
      },
    };

    saveConfig(storage, {
      nextSelector: "A",
      chapterSelector: "B",
      targetSelector: "C",
      delay: 500,
      engineMode: "html2canvas",
    });

    const loaded = loadConfig(storage);
    expect(loaded.nextSelector).toBe("A");
    expect(loaded.delay).toBe(500);
    expect(loaded.engineMode).toBe("html2canvas");
  });

  it("loadConfig 用存储值覆盖默认值", () => {
    const map = new Map<string, unknown>([["delay", 2000]]);
    const storage: StorageLike = {
      get: (k, d) => (map.has(k) ? (map.get(k) as never) : d),
      set: (k, v) => {
        map.set(k, v);
      },
    };
    const config = loadConfig(storage);
    expect(config.delay).toBe(2000);
    expect(config.nextSelector).toBe(DEFAULT_CONFIG.nextSelector);
  });
});
