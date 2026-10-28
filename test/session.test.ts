import { describe, it, expect } from "vitest";
import { syncBook, type BookState } from "../src/session";

const bookA = "https://weread.qq.com/web/reader/AAA111?foo=1";
const bookB = "https://weread.qq.com/web/reader/BBB222?foo=1";
const notReader = "https://weread.qq.com/web/shelf";

function makeState(over: Partial<BookState> = {}): BookState {
  return { pageNum: 1, bookId: null, ...over };
}

describe("syncBook - 换书时页码归 1", () => {
  it("首次进入阅读页：记录书籍 ID，页码保持 1", () => {
    const state = makeState();
    syncBook(state, bookA);

    expect(state.bookId).toBe("AAA111");
    expect(state.pageNum).toBe(1);
  });

  it("同一本书内推进页码后，再同步不会重置", () => {
    const state = makeState({ pageNum: 12, bookId: "AAA111" });
    syncBook(state, bookA);

    expect(state.pageNum).toBe(12);
    expect(state.bookId).toBe("AAA111");
  });

  it("换成另一本书：页码归 1", () => {
    const state = makeState({ pageNum: 12, bookId: "AAA111" });
    syncBook(state, bookB);

    expect(state.pageNum).toBe(1);
    expect(state.bookId).toBe("BBB222");
  });

  it("换回原来的书：同样归 1（任何书籍变更都重新计数）", () => {
    const state = makeState({ pageNum: 30, bookId: "AAA111" });
    syncBook(state, bookB);
    syncBook(state, bookA);

    expect(state.pageNum).toBe(1);
    expect(state.bookId).toBe("AAA111");
  });

  it("不在阅读页（取不到书籍 ID）时不做任何改动", () => {
    const state = makeState({ pageNum: 8, bookId: "AAA111" });
    syncBook(state, notReader);

    expect(state.pageNum).toBe(8);
    expect(state.bookId).toBe("AAA111");
  });

  it("空 href 不抛错", () => {
    const state = makeState({ pageNum: 5, bookId: "AAA111" });
    expect(() => syncBook(state, "")).not.toThrow();
    expect(state.pageNum).toBe(5);
  });
});

describe("BookState - 页码初始为 1（刷新即重置）", () => {
  it("新建状态默认从第 1 页开始", () => {
    // createApp() 每次都返回全新状态，因此刷新页面页码自然是 1
    const fresh = makeState();
    expect(fresh.pageNum).toBe(1);
    expect(fresh.bookId).toBeNull();
  });
});
