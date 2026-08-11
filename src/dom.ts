/**
 * DOM 操作辅助模块（模拟点击、滚动、样式注入等）
 */

/** 高拟真物理点击模拟器 */
export function simulateRealisticClick(element: HTMLElement | null): void {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const realWindow = element.ownerDocument.defaultView || window;

  const eventInit = {
    bubbles: true,
    cancelable: true,
    view: realWindow,
    clientX,
    clientY,
    screenX: clientX + (window.screenX || 0),
    screenY: clientY + (window.screenY || 0),
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: "mouse",
    width: 1,
    height: 1,
    isPrimary: true,
  } as PointerEventInit;

  element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  element.dispatchEvent(new PointerEvent("pointerup", eventInit));
  element.dispatchEvent(new MouseEvent("mouseup", eventInit));
  element.dispatchEvent(new MouseEvent("click", eventInit));
}

/** 智能可见性插图定位器 */
export function getVisibleImages(container: HTMLElement): HTMLImageElement[] {
  const visibleImages: HTMLImageElement[] = [];
  const contentWrappers = container.querySelectorAll<HTMLElement>(".contentWrapper");

  if (contentWrappers.length > 0) {
    contentWrappers.forEach((wrapper) => {
      const isVisible = wrapper.offsetWidth > 0 || wrapper.offsetHeight > 0;
      if (isVisible) {
        wrapper.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
          if (img.offsetWidth > 0 || img.offsetHeight > 0) {
            visibleImages.push(img);
          }
        });
      }
    });
  } else {
    container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      if (img.offsetWidth > 0 || img.offsetHeight > 0) {
        visibleImages.push(img);
      }
    });
  }

  return visibleImages;
}

/** 注入一段样式，若已存在则跳过 */
export function injectCSS(id: string, css: string, doc: Document = document): void {
  if (doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.innerHTML = css;
  doc.head.appendChild(style);
}

/** 移除已注入的样式 */
export function removeCSS(id: string, doc: Document = document): void {
  const style = doc.getElementById(id);
  if (style) style.remove();
}

/** 常态样式注入：一加载即注入，使内容容器始终处于 100% 宽度 */
export function injectGlobalCSS(doc: Document = document): void {
  injectCSS(
    "screenshot-global-override",
    ".passageContent_wrapper{width: 100% !important;}",
    doc,
  );
}

/** 样式 1 专属（临时）：注入隐藏页脚注释样式 */
export function injectStyle1CSS(doc: Document = document): void {
  injectCSS(
    "screenshot-style1-override",
    ".wr_whiteTheme .readerChapterContent .reader_footer_note{display: none !important;}",
    doc,
  );
}

/** 样式回收 */
export function removeStyle1CSS(doc: Document = document): void {
  removeCSS("screenshot-style1-override", doc);
}
