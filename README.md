# weread-screenshot

微信读书自动截图（智能双引擎插图完美融合版）—— **模块化 + 单元测试工程化版本**

> 在微信读书网页版自动逐页/逐章截图导出，完美融合插图（避免插图被切分）。支持原生 Canvas 物理合并与 html2canvas 渲染双模式。

## 技术栈

- **构建**：`Vite` + `vite-plugin-monkey`（自动生成油猴 userscript 头部、自动收集 `@grant`、CDN 外置 html2canvas）
- **语言**：TypeScript
- **测试**：`Vitest` + `happy-dom`

## 目录结构

```
src/
  main.ts          # 入口：初始化、主循环编排、启动/停止
  config.ts        # 配置读写（封装 GM_getValue/setValue，支持注入 mock）
  reader.ts        # 模式识别（章节/水平书本，纯逻辑可单测）
  merge.ts         # AABB 碰撞检测 + 画布坐标映射（纯函数）
  capture.ts       # 双引擎截图、图片 302 烘焙、画布合并
  stitch.ts        # 章节模式分段滚动截图 + 拼接长图（模式二）
  panel.ts         # 悬浮控制面板 UI
  dom.ts           # 模拟点击、滚动、样式注入等 DOM 操作
test/
  *.test.ts        # 对应模块的单元测试（独立测试目录）
```

## 章节模式（模式二）长图拼接

微信读书章节采用**虚拟渲染**，`.renderTargetContainer` 高度 = 全文高度（被内部写死高度的元素撑起），但滚动时视口外内容会被清空，导致「一次性整章渲染」出现大片空白。因此模式二（html2canvas）的章节模式改为**「全图渲染 + 可见区域覆盖拼接」**：

1. 用外层滚动容器逐段滚动到 `currentY`；
2. 每段滚动后用 html2canvas（`scale:1`）**渲染整个 `.renderTargetContainer`**（当前视口附近内容完整）；
3. 把该次渲染中「可见区域」（y = currentY 起、高 = 视口高）**复制到底板的对应偏移位置**；
4. 所有可见区域都被覆盖后，底板即为完整章节长图。

关键点：强制 `scale:1` 使 canvas 像素与滚动偏移直接对应（避免 DPR 缩放导致宽度减半/变形）；每段渲染前烘焙该段视口内的插图（base64）避免跨域污染画布。相邻段留有重叠（默认 15%）保证每个区域至少被覆盖一次，滚动期间实时显示进度。

## 常用命令

```bash
pnpm install       # 安装依赖
pnpm dev           # 开发模式（热更新，自动打开安装页）
pnpm build         # 构建，产物在 dist/weread-screenshot.user.js
pnpm typecheck     # TypeScript 类型检查
pnpm test          # 运行单元测试
pnpm test:watch    # 监听模式运行测试
pnpm coverage      # 运行测试并输出覆盖率
```

## 安装到浏览器

1. 执行 `pnpm build` 生成 `dist/weread-screenshot.user.js`
2. 打开 Tampermonkey 扩展 → 新建脚本 → 把产物内容粘贴进去（或直接用浏览器打开该文件按提示安装）
3. 访问 `https://weread.qq.com/web/reader/*`，页面右上角出现悬浮控制面板

## 单元测试说明

核心纯逻辑（碰撞检测、坐标映射、模式识别、配置读写、图片烘焙）已抽离为独立函数，可直接单测；DOM 和 `GM_*` API 通过注入 mock 隔离。

运行 `pnpm test` 会执行 `test/**/*.test.ts` 下全部测试。

## 变更日志

- **v4.0.0**：工程化重构。由单文件 `app.js` 拆分为模块化 TS 工程，引入 `vite-plugin-monkey` 构建与 `Vitest` 单测；html2canvas 改为 CDN 外置（`@require`），产物由 ~530KB 降至 ~23KB。
