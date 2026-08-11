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
  panel.ts         # 悬浮控制面板 UI
  dom.ts           # 模拟点击、滚动、样式注入等 DOM 操作
test/
  *.test.ts        # 对应模块的单元测试（独立测试目录）
```

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
