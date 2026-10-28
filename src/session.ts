/**
 * 会话状态模块：页码生命周期 + 书籍标识。
 *
 * 页码是**内存态**，不写入 GM 持久存储，因此刷新 / 重新进入页面时
 * `createApp()` 重建，页码自然归 1。
 *
 * 同一次页面会话内换书（SPA 跳转不刷新）时，靠 URL 里的书籍 ID 变化来判定。
 */

/**
 * 从阅读页 URL 解析书籍 ID。
 *
 * 微信读书阅读页路径是 **`/web/reader/{bookId}k{chapterUid}`**：
 * 书籍 ID 与章节 ID 用字面量 `k` 连接，**翻章时章节 ID 会变**。
 *
 * 关键：**没有 `k` 时一律返回 null（无法判定），绝不把整段当书籍 ID**。
 * 存在只带章节段的链接（`/web/reader/{chapterUid}`），若拿它当书籍 ID，
 * 会因为和正常 URL 解析出的值不同而误判「换书」，把页码反复重置。
 *
 * 书籍/章节 ID 的字符集是十六进制 + 分隔符 `g`，不含 `k`，按首个 `k` 切分是安全的。
 */
export function readBookId(href: string): string | null {
  const match = /\/web\/reader\/([^/?#]+)/.exec(href);
  if (!match) return null;

  const segment = match[1];
  const kIndex = segment.indexOf("k");

  // 没有分隔符 → 这不是「书籍+章节」形态，无法判定书籍
  if (kIndex <= 0) return null;

  const bookId = segment.slice(0, kIndex);
  return bookId || null;
}

/** 页码相关的最小状态（AppContext 结构上兼容） */
export interface BookState {
  /** 当前页码 */
  pageNum: number;
  /** 当前书籍 ID，null 表示尚未识别到 */
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
 * 只读判断：是否真的换了书。
 *
 * 必须**两侧都已知**且不同才算换书。任一侧为 null（URL 是章节链接、
 * 尚未识别、或不在阅读页）都返回 false —— 宁可漏判，也不能误判重置页码。
 */
export function isBookChanged(state: BookState, href: string): boolean {
  const bookId = readBookId(href);
  if (bookId === null || state.bookId === null) return false;
  return bookId !== state.bookId;
}

/**
 * 同步书籍标识。
 *
 * - 解析不到书籍 ID（章节链接 / 非阅读页）→ 什么都不做；
 * - 首次识别到 → 仅记录，**不重置页码**（避免「停止后继续」时页码被清空）；
 * - 识别到与已记录的不同 → 记录新书并**把页码归 1**。
 *
 * @returns 是否发生了真正的换书（页码已归 1）
 */
export function syncBook(state: BookState, href: string): boolean {
  const bookId = readBookId(href);
  if (bookId === null) return false;

  if (state.bookId === null) {
    state.bookId = bookId;
    return false;
  }

  if (state.bookId === bookId) return false;

  state.bookId = bookId;
  state.pageNum = 1;
  return true;
}
