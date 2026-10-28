import { describe, it, expect, vi, afterEach } from "vitest";
import { createPanel, updateStatus } from "../src/panel";
import type { Config } from "../src/config";

const baseConfig: Config = {
  nextSelector: ".next",
  chapterSelector: ".chapter",
  targetSelector: ".wr_canvasContainer canvas",
  delay: 1000,
  engineMode: "canvas",
};

function makeHandlers() {
  return {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onReset: vi.fn(),
    onConfigChange: vi.fn(),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createPanel - 布局", () => {
  it("模式选择排在按钮之前（第一行）", () => {
    const panel = createPanel(baseConfig, () => "第 1 页", makeHandlers());

    const order = Array.from(
      panel.querySelectorAll<HTMLElement>("select, button"),
    ).map((el) => el.id);

    expect(order).toEqual([
      "ipt-engine",
      "btn-start",
      "btn-stop",
      "btn-reset",
    ]);
  });

  it("首行控件是模式选择，且标题在其上方", () => {
    const panel = createPanel(baseConfig, () => "第 1 页", makeHandlers());

    const firstControl = panel.querySelector("select, button");
    expect(firstControl?.id).toBe("ipt-engine");

    const title = panel.querySelector(".asp-title");
    expect(title?.textContent).toContain("双引擎无损导出");
  });

  it("状态行在最下方", () => {
    const panel = createPanel(baseConfig, () => "第 1 页", makeHandlers());

    const lastChild = panel.lastElementChild;
    expect(lastChild?.id).toBe("txt-status");
  });
});

describe("createPanel - 交互", () => {
  it("回显已保存的引擎模式", () => {
    const panel = createPanel(
      { ...baseConfig, engineMode: "html2canvas" },
      () => "第 1 页",
      makeHandlers(),
    );

    expect((panel.querySelector("#ipt-engine") as HTMLSelectElement).value).toBe(
      "html2canvas",
    );
  });

  it("切换引擎时按模式映射 targetSelector 并回传配置", () => {
    const handlers = makeHandlers();
    const panel = createPanel(baseConfig, () => "第 1 页", handlers);
    const select = panel.querySelector("#ipt-engine") as HTMLSelectElement;

    select.value = "html2canvas";
    select.dispatchEvent(new Event("change"));

    expect(handlers.onConfigChange).toHaveBeenCalledTimes(1);
    const cfg = handlers.onConfigChange.mock.calls[0][0] as Config;
    expect(cfg.engineMode).toBe("html2canvas");
    expect(cfg.targetSelector).toBe(".renderTargetContainer");
  });

  it("切回 Canvas 时 targetSelector 指回 canvas 元素", () => {
    const handlers = makeHandlers();
    const panel = createPanel(
      { ...baseConfig, engineMode: "html2canvas" },
      () => "第 1 页",
      handlers,
    );
    const select = panel.querySelector("#ipt-engine") as HTMLSelectElement;

    select.value = "canvas";
    select.dispatchEvent(new Event("change"));

    const cfg = handlers.onConfigChange.mock.calls[0][0] as Config;
    expect(cfg.targetSelector).toBe(".wr_canvasContainer canvas");
  });

  it("开始前先保存配置再启动", () => {
    const handlers = makeHandlers();
    const panel = createPanel(baseConfig, () => "第 1 页", handlers);

    (panel.querySelector("#btn-start") as HTMLButtonElement).click();

    expect(handlers.onConfigChange).toHaveBeenCalledTimes(1);
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onConfigChange.mock.invocationCallOrder[0]).toBeLessThan(
      handlers.onStart.mock.invocationCallOrder[0],
    );
  });

  it("停止与重置各自触发对应回调", () => {
    const handlers = makeHandlers();
    const panel = createPanel(baseConfig, () => "第 1 页", handlers);

    (panel.querySelector("#btn-stop") as HTMLButtonElement).click();
    (panel.querySelector("#btn-reset") as HTMLButtonElement).click();

    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
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
