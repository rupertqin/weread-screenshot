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
        version: "0.1.0",
        description:
          "双模式并存。修复 html2canvas 章节模式下误切分图片的Bug，强制整章长图导出。支持 AABB 碰撞物理合并与模拟点击。模块化 + 单元测试工程化版本。",
        author: "Assistant",
        match: ["https://weread.qq.com/web/reader/*"],
        grant: [
          "GM_setValue",
          "GM_getValue",
          "GM_registerMenuCommand",
          // 拉取插图：GM_xmlhttpRequest 不受 CORS 限制，是跨域取图的标准手段
          "GM_xmlhttpRequest",
        ],
        // @connect 白名单。
        //
        // 微信读书插图的请求链是「res.weread.qq.com → 302 → 腾讯云 COS」，
        // 而且 COS 在签名失效/节点异常时还会再 302 回源域，形成跨多个域名的重定向链。
        // 逐个枚举域名极易漏掉某一跳，油猴会报
        //   "Request was redirected to a not whitelisted URL"
        // 直接拒绝请求。因此统一放开为 *（本脚本只用于个人阅读截图）。
        connect: [
          "*",
          "res.weread.qq.com",
          "weread.qq.com",
          "*.tencent-cloud.com",
          "*.gfp.tencent-cloud.com",
        ],
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
