/**
 * 全局配置模块
 *
 * 封装 GM_setValue / GM_getValue，隔离油猴 GM API，
 * 使其可在 Node 环境（单元测试）中通过注入 mock 正常运行。
 */

export interface Config {
  nextSelector: string;
  chapterSelector: string;
  targetSelector: string;
  delay: number;
  engineMode: "canvas" | "html2canvas";
}

export const DEFAULT_CONFIG: Config = {
  // 书本模式（下一页）
  nextSelector: ".renderTarget_pager_button_right",
  // 章节模式（下一章）
  chapterSelector: ".readerFooter_button",
  // 原生画布定位
  targetSelector: ".wr_canvasContainer canvas",
  // 渲染等待延迟
  delay: 1000,
  // 默认引擎
  engineMode: "canvas",
};

export interface StorageLike {
  get<T>(key: string, defaultValue: T): T;
  set(key: string, value: unknown): void;
}

/**
 * 基于 GM_* API 的存储实现
 * 在无 GM 环境（如单测）下自动降级为内存存储，保证可运行。
 */
export function createGMStorage(): StorageLike {
  const hasGM = typeof GM_getValue === "function" && typeof GM_setValue === "function";

  if (!hasGM) {
    const memory = new Map<string, unknown>();
    return {
      get: (key, defaultValue) => (memory.has(key) ? (memory.get(key) as never) : defaultValue),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }

  return {
    get: (key, defaultValue) => GM_getValue(key, defaultValue),
    set: (key, value) => GM_setValue(key, value),
  };
}

/** 从存储读取配置（合并默认值） */
export function loadConfig(storage: StorageLike): Config {
  return {
    nextSelector: storage.get("nextSelector", DEFAULT_CONFIG.nextSelector),
    chapterSelector: storage.get("chapterSelector", DEFAULT_CONFIG.chapterSelector),
    targetSelector: storage.get("targetSelector", DEFAULT_CONFIG.targetSelector),
    delay: storage.get("delay", DEFAULT_CONFIG.delay),
    engineMode: storage.get("engineMode", DEFAULT_CONFIG.engineMode),
  };
}

/** 将配置写入存储 */
export function saveConfig(storage: StorageLike, config: Config): void {
  storage.set("nextSelector", config.nextSelector);
  storage.set("chapterSelector", config.chapterSelector);
  storage.set("targetSelector", config.targetSelector);
  storage.set("delay", config.delay);
  storage.set("engineMode", config.engineMode);
}
