import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    monkey({
      entry: "./src/main.ts",
      userscript: {
        name: "微信读书自动截图 (智能双引擎插图完美融合版)",
        namespace: "https://github.com/weread-screenshot",
        version: "4.0.0",
        description:
          "双模式并存。修复 html2canvas 章节模式下误切分图片的Bug，强制整章长图导出。支持 AABB 碰撞物理合并与模拟点击。模块化 + 单元测试工程化版本。",
        author: "Assistant",
        match: ["https://weread.qq.com/web/reader/*"],
        grant: ["GM_setValue", "GM_getValue", "GM_registerMenuCommand"],
        "run-at": "document-end",
      },
      build: {
        // 将 html2canvas 排除出打包，改为 CDN @require 加载（UMD 全局变量名 html2canvas）
        externalGlobals: {
          html2canvas: [
            "html2canvas",
            "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
          ],
        },
      },
    }),
  ],
  build: {
    target: "esnext",
  },
});
