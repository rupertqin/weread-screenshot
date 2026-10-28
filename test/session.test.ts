import { describe, it, expect } from "vitest";
import {
  readBookId,
  isBookChanged,
  syncBook,
  type BookState,
} from "../src/session";

/** 该书的真实 URL（用户反馈的实际形态） */
const BOOK = "e7c32840813abc2fdg01312c";
const CHAPTER = "ecc32f3013eccbc87e4b62e";
const fullUrl = `https://weread.qq.com/web/reader/${BOOK}k${CHAPTER}`;

/** 只带章节段、没有 k 的链接（本次误判的根源） */
const chapterOnlyUrl = `https://weread.qq.com/web/reader/${CHAPTER}`;

function makeState(over: Partial<BookState> = {}): BookState {
  return { pageNum: 1, bookId: null, ...over };
}

describe("readBookId - 按 k 切分书籍与章节", () => {
  it("标准 {bookId}k{chapterUid} 只返回书籍部分", () => {
    expect(readBookId(fullUrl)).toBe(BOOK);
  });

  it("同一本书不同章节，书籍 ID 相同", () => {
    const other = `https://weread.qq.com/web/reader/${BOOK}k70e32fb021170efdf2eca12`;
    expect(readBookId(fullUrl)).toBe(readBookId(other));
  });

  it("没有 k 的章节链接返回 null（不能把章节当书籍）", () => {
    expect(readBookId(chapterOnlyUrl)).toBeNull();
  });

  it("k 在最开头时返回 null（避免空 bookId）", () => {
    expect(readBookId("https://weread.qq.com/web/reader/k123456")).toBeNull();
  });

  it("非阅读页返回 null", () => {
    expect(readBookId("https://weread.qq.com/web/shelf")).toBeNull();
    expect(readBookId("")).toBeNull();
  });

  it("忽略 query 与 hash", () => {
    expect(readBookId(`${fullUrl}?foo=1#bar`)).toBe(BOOK);
  });
});

describe("syncBook - 页码只在真正换书时归 1", () => {
  it("首次识别到书籍：只记录，不重置页码", () => {
    const state = makeState({ pageNum: 5 });

    expect(syncBook(state, fullUrl)).toBe(false);
    expect(state.bookId).toBe(BOOK);
    // 关键：首次识别不重置（避免「停止后继续」被清空）
    expect(state.pageNum).toBe(5);
  });

  it("同一本书翻章：页码保持不变", () => {
    const state = makeState({ pageNum: 12, bookId: BOOK });
    const nextChapter = `https://weread.qq.com/web/reader/${BOOK}k4c63226`;

    expect(syncBook(state, nextChapter)).toBe(false);
    expect(state.pageNum).toBe(12);
  });

  it("遇到无 k 的章节链接：视为无法判定，页码保持不变（回归）", () => {
    const state = makeState({ pageNum: 12, bookId: BOOK });

    expect(syncBook(state, chapterOnlyUrl)).toBe(false);
    expect(state.pageNum).toBe(12);
    expect(state.bookId).toBe(BOOK);
  });

  it("确实换到另一本书：归 1", () => {
    const state = makeState({ pageNum: 12, bookId: BOOK });
    const other = "https://weread.qq.com/web/reader/aaa111bbb222k7e5320d";

    expect(syncBook(state, other)).toBe(true);
    expect(state.pageNum).toBe(1);
    expect(state.bookId).toBe("aaa111bbb222");
  });

  it("未识别书籍时遇到无 k 链接，不会把章节记成书籍", () => {
    const state = makeState({ pageNum: 3 });

    syncBook(state, chapterOnlyUrl);
    expect(state.bookId).toBeNull();
    expect(state.pageNum).toBe(3);
  });
});

describe("isBookChanged - 运行途中的只读判定", () => {
  it("同一本书不同章节：不算换书", () => {
    const state = makeState({ pageNum: 8, bookId: BOOK });
    const nextChapter = `https://weread.qq.com/web/reader/${BOOK}k4c63226`;

    expect(isBookChanged(state, nextChapter)).toBe(false);
  });

  it("无 k 的章节链接：不算换书（本次误判的直接原因）", () => {
    const state = makeState({ pageNum: 8, bookId: BOOK });
    expect(isBookChanged(state, chapterOnlyUrl)).toBe(false);
  });

  it("尚未识别书籍时不判定换书", () => {
    const state = makeState({ pageNum: 8 });
    expect(isBookChanged(state, fullUrl)).toBe(false);
  });

  it("真的换书时返回 true，且不修改状态", () => {
    const state = makeState({ pageNum: 8, bookId: BOOK });
    const other = "https://weread.qq.com/web/reader/aaa111bbb222k7e5320d";

    expect(isBookChanged(state, other)).toBe(true);
    expect(state.pageNum).toBe(8);
    expect(state.bookId).toBe(BOOK);
  });
});
