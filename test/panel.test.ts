import { describe, it, expect, vi, afterEach } from "vitest";
import { createPanel, updateStatus } from "../src/panel";
import type { Config } from "../src/config";

const baseConfig: Config = {
  nextSelector: ".next",
  chapterSelector: ".chapter",
  targetSelector: ".wr_canvasContainer canvas",
  delay: 1000,
  engineMode: "canvas",
  imageFormat: "webp",
};

function makeHandlers() {
  return {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onConfigChange: vi.fn(),
  };
}

function mount(config: Config = baseConfig, handlers = makeHandlers()) {
  const handle = createPanel(config, () => "第 1 页", handlers);
  const panel = handle.el;
  const $ = <T extends HTMLElement>(sel: string) =>
    panel.querySelector(sel) as T;
  return { handle, panel, $, handlers };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createPanel - 布局", () => {
  it("模式选择排在按钮之前（第一行）", () => {
    const { panel } = mount();

    const order = Array.from(
      panel.querySelectorAll<HTMLElement>(".asp-body select, .asp-body button"),
    ).map((el) => el.id);

    expect(order).toEqual([
      "ipt-engine",
      "ipt-format",
      "btn-start",
      "btn-stop",
    ]);
  });

  it("首行控件是模式选择，且标题在其上方", () => {
    const { panel } = mount();

    expect(panel.querySelector(".asp-body select, .asp-body button")?.id).toBe(
      "ipt-engine",
    );
    expect(panel.querySelector(".asp-title")?.textContent).toContain(
      "截图导出",
    );
  });

  it("状态行位于可折叠主体内、且在最下方", () => {
    const { panel } = mount();
    const body = panel.querySelector(".asp-body");

    expect(body?.lastElementChild?.id).toBe("txt-status");
  });
});

describe("createPanel - 收起/展开", () => {
  it("默认展开", () => {
    const { panel, $ } = mount();

    expect(panel.classList.contains("is-collapsed")).toBe(false);
    expect($("#btn-collapse").getAttribute("aria-expanded")).toBe("true");
    expect($("#btn-collapse").title).toBe("收起");
  });

  it("点击后收起，再点恢复展开", () => {
    const { panel, $ } = mount();
    const btn = $<HTMLButtonElement>("#btn-collapse");

    btn.click();
    expect(panel.classList.contains("is-collapsed")).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.title).toBe("展开");

    btn.click();
    expect(panel.classList.contains("is-collapsed")).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.title).toBe("收起");
  });

  it("收起按钮在标题行内、且位于折叠主体之外", () => {
    const { panel } = mount();
    const head = panel.querySelector(".asp-head");

    expect(head?.querySelector("#btn-collapse")).not.toBeNull();
    // 收起后主体被隐藏，但按钮必须仍可见可点
    expect(head?.querySelector("#btn-collapse")).toBe(
      panel.querySelector("#btn-collapse"),
    );
    expect(panel.querySelector(".asp-body")?.contains(head)).toBe(false);
  });

  it("收起时宽度收到标题区实际宽度，不保留固定宽度", () => {
    const { panel, $ } = mount();
    const headMain = panel.querySelector(".asp-head-main") as HTMLElement;
    const toggle = $("#btn-collapse");

    // happy-dom 无真实布局，这里注入测量值：标题区 96px、按钮 20px
    vi.spyOn(headMain, "getBoundingClientRect").mockReturnValue({
      width: 96,
    } as DOMRect);
    vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue({
      width: 20,
    } as DOMRect);

    $<HTMLButtonElement>("#btn-collapse").click();

    // 96（标题区含状态点）+ 8（间距）+ 20（按钮）= 124，而不是 220
    expect(panel.style.width).toBe("124px");
  });

  it("收起时若无法测量（无布局环境）则回落到样式表宽度", () => {
    const { panel, $ } = mount();

    $<HTMLButtonElement>("#btn-collapse").click();

    // 读不到标题区宽度时不写内联宽度
    expect(panel.style.width).toBe("");
    expect(panel.classList.contains("is-collapsed")).toBe(true);
  });

  it("重新展开时清除内联宽度", () => {
    const { panel, $ } = mount();
    const headMain = panel.querySelector(".asp-head-main") as HTMLElement;
    vi.spyOn(headMain, "getBoundingClientRect").mockReturnValue({
      width: 96,
    } as DOMRect);

    const btn = $<HTMLButtonElement>("#btn-collapse");
    btn.click();
    expect(panel.style.width).not.toBe("");

    btn.click();
    expect(panel.style.width).toBe("");
  });

  it("状态点在标题左侧，且不在折叠主体内", () => {
    const { panel } = mount();
    const dot = panel.querySelector(".asp-dot");
    const title = panel.querySelector(".asp-title");

    expect(dot).not.toBeNull();
    // DOM 顺序：状态点在标题之前（视觉上位于文字左侧）
    expect(dot?.nextElementSibling).toBe(title);
    // 收起时主体被隐藏，状态点必须留在标题栏里才能看见
    expect(panel.querySelector(".asp-body")?.contains(dot as Node)).toBe(false);
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  it("运行中给面板加 is-running 标记（状态点变绿）", () => {
    const { handle, panel } = mount();

    expect(panel.classList.contains("is-running")).toBe(false);

    handle.setRunning(true);
    expect(panel.classList.contains("is-running")).toBe(true);

    handle.setRunning(false);
    expect(panel.classList.contains("is-running")).toBe(false);
  });

  it("收起后仍能通过状态点判断运行状态", () => {
    const { handle, panel, $ } = mount();

    handle.setRunning(true);
    $<HTMLButtonElement>("#btn-collapse").click();

    // 已收起（主体不可见），但状态标记仍在
    expect(panel.classList.contains("is-collapsed")).toBe(true);
    expect(panel.classList.contains("is-running")).toBe(true);
    expect(panel.querySelector(".asp-dot")).not.toBeNull();
  });

  it("收起状态与运行状态互不干扰", () => {
    const { handle, panel, $ } = mount();

    handle.setRunning(true);
    $<HTMLButtonElement>("#btn-collapse").click();

    // 收起后仍在运行态：停止可见、开始隐藏
    expect(panel.classList.contains("is-collapsed")).toBe(true);
    expect($("#btn-stop").style.display).toBe("");
    expect($("#btn-start").style.display).toBe("none");
  });
});

describe("createPanel - 开始/停止互斥", () => {
  it("初始只显示「开始」", () => {
    const { $ } = mount();

    expect($("#btn-start").style.display).toBe("");
    expect($("#btn-stop").style.display).toBe("none");
  });

  it("运行中只显示「停止」", () => {
    const { handle, $ } = mount();

    handle.setRunning(true);

    expect($("#btn-start").style.display).toBe("none");
    expect($("#btn-stop").style.display).toBe("");
  });

  it("停止后可切回「开始」", () => {
    const { handle, $ } = mount();

    handle.setRunning(true);
    handle.setRunning(false);

    expect($("#btn-start").style.display).toBe("");
    expect($("#btn-stop").style.display).toBe("none");
  });

  it("运行中禁用模式切换，结束后恢复", () => {
    const { handle, $ } = mount();
    const select = $<HTMLSelectElement>("#ipt-engine");

    handle.setRunning(true);
    expect(select.disabled).toBe(true);

    handle.setRunning(false);
    expect(select.disabled).toBe(false);
  });
});

describe("createPanel - 交互", () => {
  it("回显已保存的引擎模式", () => {
    const { $ } = mount({ ...baseConfig, engineMode: "html2canvas" });
    expect($<HTMLSelectElement>("#ipt-engine").value).toBe("html2canvas");
  });

  it("回显已保存的导出格式", () => {
    const { $ } = mount({ ...baseConfig, imageFormat: "png" });
    expect($<HTMLSelectElement>("#ipt-format").value).toBe("png");
  });

  it("切换格式时回传 imageFormat", () => {
    const { $, handlers } = mount();
    const select = $<HTMLSelectElement>("#ipt-format");

    select.value = "png";
    select.dispatchEvent(new Event("change"));

    const cfg = handlers.onConfigChange.mock.calls[0][0] as Config;
    expect(cfg.imageFormat).toBe("png");
  });

  it("运行中同时禁用模式与格式选择", () => {
    const { handle, $ } = mount();

    handle.setRunning(true);
    expect($<HTMLSelectElement>("#ipt-engine").disabled).toBe(true);
    expect($<HTMLSelectElement>("#ipt-format").disabled).toBe(true);

    handle.setRunning(false);
    expect($<HTMLSelectElement>("#ipt-engine").disabled).toBe(false);
    expect($<HTMLSelectElement>("#ipt-format").disabled).toBe(false);
  });

  it("切换引擎时按模式映射 targetSelector 并回传配置", () => {
    const { $, handlers } = mount();
    const select = $<HTMLSelectElement>("#ipt-engine");

    select.value = "html2canvas";
    select.dispatchEvent(new Event("change"));

    expect(handlers.onConfigChange).toHaveBeenCalledTimes(1);
    const cfg = handlers.onConfigChange.mock.calls[0][0] as Config;
    expect(cfg.engineMode).toBe("html2canvas");
    expect(cfg.targetSelector).toBe(".renderTargetContainer");
  });

  it("切回 Canvas 时 targetSelector 指回 canvas 元素", () => {
    const { $, handlers } = mount({ ...baseConfig, engineMode: "html2canvas" });
    const select = $<HTMLSelectElement>("#ipt-engine");

    select.value = "canvas";
    select.dispatchEvent(new Event("change"));

    const cfg = handlers.onConfigChange.mock.calls[0][0] as Config;
    expect(cfg.targetSelector).toBe(".wr_canvasContainer canvas");
  });

  it("开始前先保存配置再启动", () => {
    const { $, handlers } = mount();

    $<HTMLButtonElement>("#btn-start").click();

    expect(handlers.onConfigChange).toHaveBeenCalledTimes(1);
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onConfigChange.mock.invocationCallOrder[0]).toBeLessThan(
      handlers.onStart.mock.invocationCallOrder[0],
    );
  });

  it("停止按钮触发 onStop", () => {
    const { $, handlers } = mount();

    $<HTMLButtonElement>("#btn-stop").click();

    expect(handlers.onStop).toHaveBeenCalledTimes(1);
  });

  it("不再有「重置」按钮（页码改为自动管理）", () => {
    const { panel } = mount();
    expect(panel.querySelector("#btn-reset")).toBeNull();
  });
});

describe("updateStatus", () => {
  it("统一加「状态: 」前缀", () => {
    const el = document.createElement("div");
    updateStatus(el, "已完成");
    expect(el.innerText).toBe("状态: 已完成");
  });

  it("传入 null 时不报错", () => {
    expect(() => updateStatus(null, "x")).not.toThrow();
  });
});
