// ==UserScript==
// @name         微信读书自动截图 (智能双引擎插图完美融合版)
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  双模式并存。修复 html2canvas 章节模式下误切分图片的Bug，强制整章长图导出。支持 AABB 碰撞物理合并与模拟点击。
// @author       Assistant
// @match        https://weread.qq.com/web/reader/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  // ================= 配置区域 =================
  const DEFAULT_CONFIG = {
    nextBtnSelector: ".renderTarget_pager_button_right", // 书本模式（下一页）
    chapterBtnSelector: ".readerFooter_button", // 章节模式（下一章）
    captureSelector: ".wr_canvasContainer canvas", // 原生画布定位
    delayTime: 1000, // 渲染等待延迟
    engineMode: "canvas", // 默认引擎：'canvas'(原生) / 'html2canvas'(渲染)
  };
  // ===========================================

  // 初始化配置
  let nextSelector = GM_getValue(
    "nextSelector",
    DEFAULT_CONFIG.nextBtnSelector,
  );
  let chapterSelector = GM_getValue(
    "chapterSelector",
    DEFAULT_CONFIG.chapterBtnSelector,
  );
  let targetSelector = GM_getValue(
    "targetSelector",
    DEFAULT_CONFIG.captureSelector,
  );
  let delay = GM_getValue("delay", DEFAULT_CONFIG.delayTime);
  let currentEngine = GM_getValue("currentEngine", DEFAULT_CONFIG.engineMode);

  // 运行锁
  let isLoopRunning = false;

  // 创建悬浮控制面板
  function createPanel() {
    const div = document.createElement("div");
    div.id = "auto-screenshot-panel";
    div.style.position = "fixed";
    div.style.top = "20px";
    div.style.right = "20px";
    div.style.zIndex = "100000";
    div.style.background = "#ffffff";
    div.style.border = "1px solid #ccc";
    div.style.padding = "12px";
    div.style.borderRadius = "8px";
    div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    div.style.fontFamily = "Arial, sans-serif";
    div.style.fontSize = "12px";
    div.style.width = "240px";

    div.innerHTML =
      '<h4 style="margin: 0 0 8px 0; font-size: 14px;">双引擎无损导出助手</h4>' +
      '<div style="margin-bottom: 6px;">' +
      "<label>导出引擎:</label>" +
      '<select id="ipt-engine" style="width:100%; box-sizing:border-box; margin-top:2px; height: 24px;">' +
      '<option value="canvas" ' +
      (currentEngine === "canvas" ? "selected" : "") +
      ">模式一：原生 Canvas 物理合并 (极速)</option>" +
      '<option value="html2canvas" ' +
      (currentEngine === "html2canvas" ? "selected" : "") +
      ">模式二：html2canvas 容器渲染</option>" +
      "</select>" +
      "</div>" +
      '<div style="margin-bottom: 6px;">' +
      "<label>下一页选择器 (书本):</label>" +
      '<input type="text" id="ipt-next" value="' +
      nextSelector +
      '" style="width:100%; box-sizing:border-box; margin-top:2px;">' +
      "</div>" +
      '<div style="margin-bottom: 6px;">' +
      "<label>下一章选择器 (章节):</label>" +
      '<input type="text" id="ipt-chapter" value="' +
      chapterSelector +
      '" style="width:100%; box-sizing:border-box; margin-top:2px;">' +
      "</div>" +
      '<div style="margin-bottom: 6px;">' +
      "<label>画布/区域选择器:</label>" +
      '<input type="text" id="ipt-target" value="' +
      targetSelector +
      '" style="width:100%; box-sizing:border-box; margin-top:2px;">' +
      "</div>" +
      '<div style="margin-bottom: 10px;">' +
      "<label>等待延迟 (毫秒):</label>" +
      '<input type="number" id="ipt-delay" value="' +
      delay +
      '" style="width:100%; box-sizing:border-box; margin-top:2px;">' +
      "</div>" +
      '<div style="display: flex; justify-content: space-between;">' +
      '<button id="btn-start" style="padding: 5px 10px; cursor: pointer; background:#28a745; color:white; border:none; border-radius:3px;">开始</button>' +
      '<button id="btn-stop" style="padding: 5px 10px; cursor: pointer; background:#dc3545; color:white; border:none; border-radius:3px;">停止</button>' +
      '<button id="btn-reset" style="padding: 5px 5px; cursor: pointer; background:#6c757d; color:white; border:none; border-radius:3px;">重置页码</button>' +
      "</div>" +
      '<div style="margin-top: 8px; color: #666;" id="txt-status">' +
      "状态: 准备就绪" +
      "</div>";

    document.body.appendChild(div);

    // 智能联动：切换引擎时，自动调整默认选择器
    document
      .getElementById("ipt-engine")
      .addEventListener("change", function (e) {
        const engine = e.target.value;
        const targetIpt = document.getElementById("ipt-target");
        if (engine === "html2canvas") {
          targetIpt.value = ".renderTargetContainer";
        } else {
          targetIpt.value = ".wr_canvasContainer canvas";
        }
        saveConfig();
      });

    // 绑定按钮事件
    document
      .getElementById("btn-start")
      .addEventListener("click", startProcess);
    document.getElementById("btn-stop").addEventListener("click", stopProcess);
    document
      .getElementById("btn-reset")
      .addEventListener("click", resetPageCounter);
  }

  // 保存面板配置
  function saveConfig() {
    const nSel = document.getElementById("ipt-next").value;
    const cSel = document.getElementById("ipt-chapter").value;
    const tSel = document.getElementById("ipt-target").value;
    const dVal =
      parseInt(document.getElementById("ipt-delay").value, 10) || 1000;
    const eMode = document.getElementById("ipt-engine").value;

    GM_setValue("nextSelector", nSel);
    GM_setValue("chapterSelector", cSel);
    GM_setValue("targetSelector", tSel);
    GM_setValue("delay", dVal);
    GM_setValue("currentEngine", eMode);

    nextSelector = nSel;
    chapterSelector = cSel;
    targetSelector = tSel;
    delay = dVal;
    currentEngine = eMode;
  }

  // 重置页码
  function resetPageCounter() {
    GM_setValue("pageCounter", 1);
    updateStatus("页码已重置为 1");
  }

  // 更新状态文本
  function updateStatus(text) {
    const txt = document.getElementById("txt-status");
    if (txt) {
      const page = GM_getValue("pageCounter", 1);
      const reader = getReaderInfo();
      const pageTypeLabel =
        reader.mode === "chapter" ? "当前章号" : "下一张页码";
      txt.innerText = "状态: " + text + " (" + pageTypeLabel + ":" + page + ")";
    }
  }

  // 开始流程
  function startProcess() {
    saveConfig();
    if (isLoopRunning) {
      updateStatus("已在运行中，请勿重复点击");
      return;
    }

    GM_setValue("session_startPage", GM_getValue("pageCounter", 1));
    GM_setValue("session_savedCount", 0);
    GM_setValue("session_startTime", Date.now());

    GM_setValue("isRunning", true);
    isLoopRunning = true;
    updateStatus("正在启动...");
    executeStep();
  }

  // 停止流程
  function stopProcess() {
    GM_setValue("isRunning", false);
    isLoopRunning = false;
    removeStyle1CSS();
    updateStatus("已暂停");
  }

  // 结束通知
  function finishTask(reason) {
    GM_setValue("isRunning", false);
    isLoopRunning = false;
    removeStyle1CSS();
    updateStatus("已完成！" + reason);

    const startPage = GM_getValue("session_startPage", 1);
    const savedCount = GM_getValue("session_savedCount", 0);
    const startTime = GM_getValue("session_startTime", Date.now());
    const endTime = Date.now();

    const durationSeconds = Math.round((endTime - startTime) / 1000);
    const endPage = GM_getValue("pageCounter", 1) - 1;
    const reader = getReaderInfo();

    const summaryMessage =
      "🎉 微信读书自动截图任务已顺利完成！\n\n" +
      "📋 智能双引擎任务总结：\n" +
      "-----------------------------------\n" +
      "🔹 识别类型：" +
      (reader.mode === "chapter" ? "章节模式 (Chapter)" : "书本模式 (Book)") +
      "\n" +
      "🔹 页面范围：第 " +
      startPage +
      " " +
      (reader.mode === "chapter" ? "章" : "页") +
      " ➔ 第 " +
      endPage +
      " " +
      (reader.mode === "chapter" ? "章" : "页") +
      "\n" +
      "🔹 累计保存：" +
      savedCount +
      " 张无损合并原图\n" +
      "🔹 任务耗时：" +
      durationSeconds +
      " 秒\n" +
      "🔹 结束原因：" +
      reason +
      "\n" +
      "-----------------------------------\n" +
      "提示：支持原生 Canvas 高仿真合并与 html2canvas 一键章节长图模式。";

    setTimeout(function () {
      alert(summaryMessage);
    }, 300);
  }

  // 辅助：触发下载 (基于 Canvas 对象)
  function triggerDownload(canvas, filename) {
    try {
      const dataUrl = canvas.toDataURL("image/png");
      triggerDownloadDataUrl(dataUrl, filename);
    } catch (e) {
      console.error("Canvas 导出失败：", e);
    }
  }

  // 辅助：触发下载 (基于 DataURL 字符串)
  function triggerDownloadDataUrl(dataUrl, filename) {
    const downloadLink = document.createElement("a");
    downloadLink.href = dataUrl;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    const currentCount = GM_getValue("session_savedCount", 0);
    GM_setValue("session_savedCount", currentCount + 1);
  }

  // 辅助：裁切并下载 (用于 html2canvas 对半分割)
  function cropCanvasAndDownload(sourceCanvas, sx, sy, sw, sh, filename) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    const ctx = tempCanvas.getContext("2d");
    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    triggerDownload(tempCanvas, filename);
  }

  // 智能可见性插图定位器
  function getVisibleImages(container) {
    const visibleImages = [];
    const contentWrappers = container.querySelectorAll(".contentWrapper");

    if (contentWrappers.length > 0) {
      contentWrappers.forEach(function (wrapper) {
        const isVisible = wrapper.offsetWidth > 0 || wrapper.offsetHeight > 0;
        if (isVisible) {
          const imgs = wrapper.querySelectorAll("img");
          imgs.forEach(function (img) {
            if (img.offsetWidth > 0 || img.offsetHeight > 0) {
              visibleImages.push(img);
            }
          });
        }
      });
    } else {
      const allImgs = container.querySelectorAll("img");
      allImgs.forEach(function (img) {
        if (img.offsetWidth > 0 || img.offsetHeight > 0) {
          visibleImages.push(img);
        }
      });
    }

    return visibleImages;
  }

  // 核心：图片追踪 302 重定向并就地烘焙成 Base64
  async function bakeImagesToBase64(images) {
    const originalSources = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const originalSrc = img.src;

      if (originalSrc.indexOf("data:") === 0) {
        originalSources.push({ el: img, src: originalSrc });
        continue;
      }

      try {
        const response = await fetch(originalSrc);
        if (!response.ok) throw new Error("Fetch failed");

        const blob = await response.blob();

        const base64Data = await new Promise(function (resolve, reject) {
          const reader = new FileReader();
          reader.onloadend = function () {
            resolve(reader.result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        originalSources.push({ el: img, src: originalSrc });
        img.src = base64Data;
      } catch (err) {
        console.error("图片烘焙失败，保留原地址:", originalSrc, err);
        originalSources.push({ el: img, src: originalSrc });
      }
    }
    return originalSources;
  }

  // 还原图片的原始 src 地址
  function restoreImageSources(sources) {
    sources.forEach(function (item) {
      item.el.src = item.src;
    });
  }

  // 常态样式注入：一加载即注入，使内容容器始终处于 100% 宽度
  function injectGlobalCSS() {
    const styleId = "screenshot-global-override";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.innerHTML = ".passageContent_wrapper{width: 100% !important;}";
      document.head.appendChild(style);
    }
  }

  // 样式 1 专属（临时）：注入隐藏页脚注释样式
  function injectStyle1CSS() {
    const styleId = "screenshot-style1-override";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.innerHTML =
        ".wr_whiteTheme .readerChapterContent .reader_footer_note{display: none !important;}";
      document.head.appendChild(style);
    }
  }

  // 样式回收
  function removeStyle1CSS() {
    const style = document.getElementById("screenshot-style1-override");
    if (style) {
      style.remove();
    }
  }

  // 碰撞与合并算法：在 Canvas 表面重构绝对定位的插图
  function mergeImagesToCanvas(canvas, visibleImages) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rectCanvas = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rectCanvas.width;
    const scaleY = canvas.height / rectCanvas.height;

    visibleImages.forEach(function (img) {
      const rectImg = img.getBoundingClientRect();

      const overlap = !(
        rectCanvas.right < rectImg.left ||
        rectCanvas.left > rectImg.right ||
        rectCanvas.bottom < rectImg.top ||
        rectCanvas.top > rectImg.bottom
      );

      if (overlap) {
        const dx = (rectImg.left - rectCanvas.left) * scaleX;
        const dy = (rectImg.top - rectCanvas.top) * scaleY;
        const dw = rectImg.width * scaleX;
        const dh = rectImg.height * scaleY;

        ctx.drawImage(img, dx, dy, dw, dh);
      }
    });
  }

  // 内存克隆合并算法
  function getMergedCanvasDataUrl(canvas, visibleImages) {
    const clone = document.createElement("canvas");
    clone.width = canvas.width;
    clone.height = canvas.height;
    const ctx = clone.getContext("2d");
    ctx.drawImage(canvas, 0, 0);

    mergeImagesToCanvas(clone, visibleImages);

    return clone.toDataURL("image/png");
  }

  // 章节模式专属：平滑滚动到页面底部以触发 DOM 渲染与资源加载
  async function smoothScrollToBottom() {
    const distance = 200;
    const scrollDelay = 150;

    while (
      window.innerHeight + window.scrollY <
      document.documentElement.scrollHeight - 50
    ) {
      window.scrollBy(0, distance);
      await new Promise((resolve) => setTimeout(resolve, scrollDelay));

      if (!GM_getValue("isRunning", false)) {
        return false;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    return true;
  }

  // 高拟真物理点击模拟器
  function simulateRealisticClick(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const realWindow = document.defaultView || window;

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: realWindow,
      clientX: clientX,
      clientY: clientY,
      screenX: clientX + (window.screenX || 0),
      screenY: clientY + (window.screenY || 0),
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      width: 1,
      height: 1,
      isPrimary: true,
    };

    element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    element.dispatchEvent(new MouseEvent("mousedown", eventInit));
    element.dispatchEvent(new PointerEvent("pointerup", eventInit));
    element.dispatchEvent(new MouseEvent("mouseup", eventInit));
    element.dispatchEvent(new MouseEvent("click", eventInit));
  }

  // 探测当前微信读书的阅读器版面 (加固判断，防止模式误判)
  function getReaderInfo() {
    const hasHorizontalClass = !!document.querySelector(".wr_horizontalReader");
    const hasChapterFooter = !!document.querySelector(chapterSelector);

    // 只有显式包含水平类名，且不包含下一章按钮时，才判定为水平模式
    if (hasHorizontalClass && !hasChapterFooter) {
      return { mode: "horizontal", nextBtnSelector: nextSelector };
    }
    // 否则锁定为章节模式
    return { mode: "chapter", nextBtnSelector: chapterSelector };
  }

  // 执行单步
  async function executeStep() {
    // 【检查点1】
    if (!GM_getValue("isRunning", false)) {
      stopProcess();
      return;
    }

    const reader = getReaderInfo();

    // 章节模式专属：平滑滚动到底部触发全章加载
    if (reader.mode === "chapter") {
      updateStatus("正在平滑细致滚动页面以彻底渲染全部内容...");
      const scrollSuccess = await smoothScrollToBottom();
      if (!scrollSuccess) {
        stopProcess();
        return;
      }
    }

    updateStatus("等待页面渲染...");
    await new Promise((resolve) => setTimeout(resolve, delay));

    // 【检查点2】
    if (!GM_getValue("isRunning", false)) {
      stopProcess();
      return;
    }

    // 定位主 DOM 元素/画布
    const target = document.querySelector(targetSelector);
    if (!target) {
      finishTask("未探测到书籍目标元素（可能已到达图书末端或加载失败）");
      return;
    }

    let pageNum = GM_getValue("pageCounter", 1);

    // 解析页面 Canvas 用于单双页样式判断
    const rawElements = document.querySelectorAll(".wr_canvasContainer canvas");
    const canvasList = [];
    rawElements.forEach(function (el) {
      canvasList.push(el);
    });

    // ================= 样式 1 (水平单页) 注入检测 =================
    if (reader.mode === "horizontal" && canvasList.length === 1) {
      injectStyle1CSS();
    } else {
      removeStyle1CSS();
    }

    // 【检查点3】
    if (!GM_getValue("isRunning", false)) {
      stopProcess();
      return;
    }

    // 获取可见插图，并在内存中进行 302 重定向烘焙
    const containerElement =
      document.querySelector(".renderTargetContainer") || document.body;
    const visibleImages = getVisibleImages(containerElement);
    let bakedSources = [];

    if (visibleImages.length > 0) {
      updateStatus("正在预解析插图并追踪 302 跳转...");
      bakedSources = await bakeImagesToBase64(visibleImages);
    }

    // ========================== 核心：双引擎逻辑分支 ==========================
    if (currentEngine === "canvas") {
      // ------------------ 引擎一：原生 Canvas 模式 ------------------
      const canvasListForEngine = [];
      if (target instanceof HTMLCanvasElement) {
        canvasListForEngine.push(target);
      } else {
        const subCanvases = target.querySelectorAll("canvas");
        subCanvases.forEach(function (c) {
          canvasListForEngine.push(c);
        });
      }

      if (canvasListForEngine.length === 0) {
        finishTask("原生 Canvas 模式下未找到可用的 Canvas 画布");
        restoreImageSources(bakedSources);
        return;
      }

      updateStatus("正在通过原生 Canvas 进行碰撞合并导出...");

      if (reader.mode === "chapter") {
        for (let index = 0; index < canvasListForEngine.length; index++) {
          const canvas = canvasListForEngine[index];
          const mergedDataUrl = getMergedCanvasDataUrl(canvas, visibleImages);
          triggerDownloadDataUrl(
            mergedDataUrl,
            "screenshot_page_" + pageNum + "-" + (index + 1) + ".png",
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        GM_setValue("pageCounter", pageNum + 1);
        updateStatus(
          "[Canvas] 已保存并合成第 " +
            pageNum +
            " 章共 " +
            canvasListForEngine.length +
            " 页",
        );
      } else {
        for (let index = 0; index < canvasListForEngine.length; index++) {
          const canvas = canvasListForEngine[index];
          const mergedDataUrl = getMergedCanvasDataUrl(canvas, visibleImages);
          triggerDownloadDataUrl(
            mergedDataUrl,
            "screenshot_page_" + (pageNum + index) + ".png",
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        GM_setValue("pageCounter", pageNum + canvasListForEngine.length);
        updateStatus(
          "[Canvas] 已自适应并合成当前视窗内的 " +
            canvasListForEngine.length +
            " 页",
        );
      }
    } else {
      // ------------------ 引擎二：html2canvas 模式 ------------------
      updateStatus("正在通过 html2canvas 渲染整页/整章长图...");

      // 模式二下，强制锁定目标元素为 .renderTargetContainer
      const h2cTarget =
        document.querySelector(".renderTargetContainer") || target;

      const pager = document.querySelector(
        ".renderTargetContainer .renderTarget_pager",
      );
      const header = document.querySelector(
        ".renderTargetContainer .renderTargetPageInfo_header",
      );

      const origPagerVis = pager ? pager.style.visibility : "";
      const origHeaderVis = header ? header.style.visibility : "";

      if (pager) pager.style.visibility = "hidden";
      if (header) header.style.visibility = "hidden";

      try {
        const innerCanvasCount = canvasList.length;

        const h2cOptions = {
          useCORS: true,
          logging: false,
          allowTaint: true,
        };

        // 仅在水平书本模式下执行克隆 DOM 物理碰撞融合
        if (reader.mode === "horizontal") {
          h2cOptions.onclone = function (clonedDoc) {
            const clonedTarget =
              clonedDoc.querySelector(".renderTargetContainer") ||
              clonedDoc.body;
            const clonedCanvases = clonedTarget.querySelectorAll("canvas");
            const clonedVisibleImages = getVisibleImages(clonedTarget);

            clonedCanvases.forEach(function (canvas) {
              mergeImagesToCanvas(canvas, clonedVisibleImages);
            });
          };
        }

        // 渲染整页容器 .renderTargetContainer
        const renderedCanvas = await html2canvas(h2cTarget, h2cOptions);

        if (!GM_getValue("isRunning", false)) {
          stopProcess();
          return;
        }

        // 【核心逻辑保障】：只有在“水平模式”且“包含2个Canvas”时，才进行对半切分！
        // 章节模式 (reader.mode === 'chapter') 绝对不切分，直接完整导出为整章长图！
        if (reader.mode === "horizontal" && innerCanvasCount === 2) {
          const originalWidth = renderedCanvas.width;
          const originalHeight = renderedCanvas.height;
          const halfWidth = originalWidth / 2;

          cropCanvasAndDownload(
            renderedCanvas,
            0,
            0,
            halfWidth,
            originalHeight,
            "screenshot_page_" + pageNum + ".png",
          );
          await new Promise((resolve) => setTimeout(resolve, 300));
          cropCanvasAndDownload(
            renderedCanvas,
            halfWidth,
            0,
            halfWidth,
            originalHeight,
            "screenshot_page_" + (pageNum + 1) + ".png",
          );

          GM_setValue("pageCounter", pageNum + 2);
          updateStatus(
            "[html2canvas] 水平双页切分已保存第 " +
              pageNum +
              " 和 " +
              (pageNum + 1) +
              " 页",
          );
        } else {
          // 样式 1 (水平单页) 或 样式 3 (章节长图)：完整导出整图，绝不切分
          const dataUrl = renderedCanvas.toDataURL("image/png");
          triggerDownloadDataUrl(
            dataUrl,
            "screenshot_page_" + pageNum + ".png",
          );

          GM_setValue("pageCounter", pageNum + 1);
          updateStatus(
            "[html2canvas] 已成功导出整页/整章长图第 " + pageNum + " 页",
          );
        }
      } catch (err) {
        console.error("html2canvas 渲染失败:", err);
        updateStatus("渲染截图失败，尝试继续...");
      } finally {
        restoreImageSources(bakedSources);

        if (pager) pager.style.visibility = origPagerVis;
        if (header) header.style.visibility = origHeaderVis;
      }
    }

    // 【检查点4】
    if (!GM_getValue("isRunning", false)) {
      stopProcess();
      return;
    }

    // 获取并触发跳转
    const nextBtn = document.querySelector(reader.nextBtnSelector);
    const isBtnVisible =
      reader.mode === "chapter"
        ? !!nextBtn
        : nextBtn && (nextBtn.offsetWidth > 0 || nextBtn.offsetHeight > 0);

    if (nextBtn && isBtnVisible) {
      updateStatus("正在跳转...");
      simulateRealisticClick(nextBtn);

      setTimeout(function () {
        // 【检查点5】
        if (GM_getValue("isRunning", false)) {
          executeStep();
        } else {
          stopProcess();
        }
      }, 1200);
    } else {
      finishTask("未探测到后续翻页按钮（书本已到最后一页或最后一章）");
    }
  }

  // 初始化
  function init() {
    createPanel();
    injectGlobalCSS(); // 初始化常态样式
    if (GM_getValue("isRunning", false)) {
      isLoopRunning = true;
      executeStep();
    }
  }

  setTimeout(init, 500);
})();
