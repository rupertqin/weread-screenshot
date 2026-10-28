/**
 * 会话状态模块：页码的生命周期管理。
 *
 * 页码是**内存态**，不写入 GM 持久存储，因此：
 *   - 刷新 / 重新进入页面 → `createApp()` 重建，页码自然归 1；
 *   - 同一页面内换书（SPA 跳转，不发生刷新）→ 由 {@link syncBook} 检测并归 1。
 */

import { getBookId } from "./reader";

/** 页码相关的最小状态（AppContext 结构上兼容） */
export interface BookState {
  /** 当前页码 */
  pageNum: number;
  /** 当前书籍 ID，用于检测换书 */
  bookId: string | null;
}

/** 读取当前页面地址，异常时返回空串 */
export function currentHref(): string {
  try {
    return window.location.href;
  } catch {
    return "";
  }
}

/**
 * 同步当前书籍：检测到换书时把页码归 1。
 *
 * 取不到书籍 ID（不在阅读页）时不改动任何状态。
 *
 * @param href 当前页面地址（显式传入便于单测）
 */
export function syncBook(state: BookState, href: string): void {
  const bookId = getBookId(href);
  if (!bookId) return;

  if (state.bookId !== bookId) {
    state.bookId = bookId;
    state.pageNum = 1;
  }
}
