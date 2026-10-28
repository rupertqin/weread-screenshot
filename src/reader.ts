/**
 * 阅读器模式识别模块（纯逻辑，可单测）
 */

export type ReaderMode = "chapter" | "horizontal";

export interface ReaderInfo {
  mode: ReaderMode;
  /** 对应模式下使用的翻页/翻章按钮选择器 */
  nextBtnSelector: string;
}

export interface ReaderDom {
  /** 是否存在水平阅读器类名 */
  hasHorizontalClass: boolean;
  /** 是否存在下一章按钮 */
  hasChapterFooter: boolean;
}

/** 根据 DOM 特征判定当前模式（无 DOM 依赖，便于单测） */
export function detectReaderInfo(dom: ReaderDom, chapterSelector: string, nextSelector: string): ReaderInfo {
  // 只有显式包含水平类名，且不包含下一章按钮时，才判定为水平模式
  if (dom.hasHorizontalClass && !dom.hasChapterFooter) {
    return { mode: "horizontal", nextBtnSelector: nextSelector };
  }
  // 否则锁定为章节模式
  return { mode: "chapter", nextBtnSelector: chapterSelector };
}

/** 从真实 document 读取 DOM 特征并识别模式 */
export function getReaderInfo(
  doc: Document,
  chapterSelector: string,
  nextSelector: string,
): ReaderInfo {
  const dom: ReaderDom = {
    hasHorizontalClass: !!doc.querySelector(".wr_horizontalReader"),
    hasChapterFooter: !!doc.querySelector(chapterSelector),
  };
  return detectReaderInfo(dom, chapterSelector, nextSelector);
}
