import { describe, it, expect } from "vitest";
import { detectReaderInfo, getReaderInfo, type ReaderDom } from "../src/reader";

describe("detectReaderInfo - 模式判定（纯逻辑）", () => {
  const chapterSel = ".readerFooter_button";
  const nextSel = ".renderTarget_pager_button_right";

  it("有水平类名且无下一章按钮 -> 水平模式，使用 nextSelector", () => {
    const dom: ReaderDom = { hasHorizontalClass: true, hasChapterFooter: false };
    expect(detectReaderInfo(dom, chapterSel, nextSel)).toEqual({
      mode: "horizontal",
      nextBtnSelector: nextSel,
    });
  });

  it("无水平类名 -> 章节模式，使用 chapterSelector", () => {
    const dom: ReaderDom = { hasHorizontalClass: false, hasChapterFooter: false };
    expect(detectReaderInfo(dom, chapterSel, nextSel)).toEqual({
      mode: "chapter",
      nextBtnSelector: chapterSel,
    });
  });

  it("有水平类名但有下一章按钮 -> 章节模式（加固判断，防止误判）", () => {
    const dom: ReaderDom = { hasHorizontalClass: true, hasChapterFooter: true };
    expect(detectReaderInfo(dom, chapterSel, nextSel)).toEqual({
      mode: "chapter",
      nextBtnSelector: chapterSel,
    });
  });
});

describe("getReaderInfo - 从 document 识别", () => {
  it("document 含水平阅读器类名时判定为水平模式", () => {
    document.body.innerHTML = '<div class="wr_horizontalReader"></div>';
    const info = getReaderInfo(
      document,
      ".readerFooter_button",
      ".renderTarget_pager_button_right",
    );
    expect(info.mode).toBe("horizontal");
  });

  it("document 含下一章按钮时判定为章节模式", () => {
    document.body.innerHTML = '<button class="readerFooter_button">下一章</button>';
    const info = getReaderInfo(
      document,
      ".readerFooter_button",
      ".renderTarget_pager_button_right",
    );
    expect(info.mode).toBe("chapter");
  });
});
