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
  image-fetch.ts   # 插图取字节：GM 通道（自动跟随→手动逐跳）、浏览器 fetch、会话缓存
  image-load.ts    # 字节 → 可绘制对象 / base64，多图受限并发调度
  canvas-ops.ts    # 画布碰撞合并、克隆导出、裁切下载
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

## 插图加载机制（重要）

微信读书插图 URL（`res.weread.qq.com/wrepub/...`）的实测行为：

1. 返回 **302 重定向**到腾讯云 COS 地址，附带 **`q-sign-time` 短时效签名（约 10 分钟过期）**；
2. 签名绑定 `host`，无签名直接访问 COS 返回 **401**；
3. 最终响应带 **`Content-Disposition: attachment`** —— 这就是「浏览器直接打开图片地址会变成下载」的原因，但它对页面里 `<img>` 的显示**没有影响**（`img` 会忽略该响应头）；
4. 图片 CDN 的 CORS **只对 `Origin: https://weread.qq.com` 白名单**放行（`Access-Control-Allow-Origin` 精确匹配 + `Access-Control-Allow-Credentials: true`）。

**关键结论**：页面 `<img>` 没有 `crossOrigin` 属性，属于 no-cors 加载，直接 `drawImage` 会污染画布（`toDataURL` 抛 `SecurityError`）。因此必须准备一个「可安全绘制的副本」。

另外实测发现：**普通浏览器 `fetch` 请求这个图片经常在 DevTools 里显示 `canceled`**（CORS 判定 / 跨域重定向 / 代理环境都可能触发），所以 `fetch` 不能作为主路径。

当前实现（`prepareDrawableImages` / `srcToDrawable`）按可靠性分级：

| 顺序 | 方式 | 说明 |
|------|------|------|
| 1 | **`GM_xmlhttpRequest`，`redirect:"follow"`** | **首选**。授权到位时一次请求就拿到图（实测 ScriptCat 亦可） |
| 2 | **同上传图，回退 `redirect:"manual"` 逐跳** | 仅当第 1 步出现**网络层失败**（含 `redirected to a not whitelisted URL`）才触发：自己读 `Location` 逐跳请求，每次只发一条不跳转的请求 |
| 3 | Blob → `createImageBitmap` | 得到位图，绘制时**绝不污染画布** |
| 4 | Blob → dataURL → `Image` | 环境不支持 `createImageBitmap` 时降级 |
| 5 | 浏览器 `fetch` → Blob | **仅在 GM 不可用**时使用（受 CORS 约束，多数情况必失败） |
| — | 全部失败则**跳过该图** | 不阻断导出、不污染画布 |

所需权限（已写入 userscript header）：

```
// @grant   GM_xmlhttpRequest
// @connect *
```

> **为什么还需要手动逐跳**：插图链路是「`res.weread.qq.com` → 302 → 腾讯云 COS」，而 `res.weread.qq.com` 的 **302 响应没有 `Access-Control-Allow-Origin`**——按 Fetch 规范 CORS 请求要校验重定向链上的**每一个**响应，所以浏览器 `fetch` 和 `<img crossOrigin>` 都在第一跳就挂。
> 走 `GM_xmlhttpRequest` 则不经过 CORS 判定，正常情况下一次请求即可。只有管理器的跨域重定向白名单介入时才需要降级为手动逐跳，所以它只作为**自动兜底**，不再是用户选项。
>
> 另外 `blob:` / `data:` 属同源资源，直接走浏览器 `fetch`。

每次点「开始」会打印：`[截图] 启动 | 引擎=canvas|html2canvas`；有插图时会打印
`[插图] 取图通道：GM_xmlhttpRequest=可用，createImageBitmap=可用，并发=4`。

**性能与请求量优化**：

- **受限并发取图**（`mapWithConcurrency`，默认 4 路）：多张插图并行获取，结果顺序与入参一致；
- **会话级 Promise 缓存**（`imageBlobCache`，上限 100 条 FIFO 淘汰）：同一张图跨页/跨章节只取一次，且并发时同一 URL 会复用**进行中的 Promise**，不会重复下载；
- **只对瞬时错误重试**（网络错误 / 超时），`HTTP 4xx`、`0 字节`、`缺少 Location` 属确定性失败，直接放弃，不浪费第二次请求；失败结果不写入缓存，下次仍可重试；
- **GM 可用时不再回退浏览器 `fetch`**：该路径几乎必然被 CORS 拒绝，只会刷一屏错误日志。

**可绘制性校验** `isSafeToDraw`：`ImageBitmap` 恒安全；`HTMLImageElement` 仅当 `src` 为 `data:` 或 `crossOrigin="anonymous"` 时才允许 `drawImage`，从源头避免 `toDataURL` 抛 `SecurityError`。`ImageBitmap` 判定用鸭子类型（`width`/`height`/`close`）而非 `instanceof`，以兼容油猴沙箱的跨 realm 场景。

- **Canvas 引擎**：`prepareDrawableImages` 得到 `{ el, img }` —— `el`（页面原图）只负责 `getBoundingClientRect` 定位，`img`（ImageBitmap 副本）负责绘制；
- **html2canvas 引擎**：`bakeImagesToBase64` 把 `img.src` 就地换成 base64（fetch → Blob → dataURL），供 html2canvas 读取；章节拼接时用 `createCachedImageBaker` 按 src 缓存，相邻分段不重复拉取。

**排查日志**：每次执行会在控制台输出
`[插图] 容器=... 页面 img 总数=N 判定可见=M` 与 `[插图] 页面可见插图 N 张，成功准备 X 张，失败 Y 张`。
若「判定可见=0」说明是插图定位（`getVisibleImages`）问题；若「失败=Y」说明是加载被拦截。

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

- **v0.1.0**：工程化重构。由单文件 `app.js` 拆分为模块化 TS 工程，引入 `vite-plugin-monkey` 构建与 `Vitest` 单测；html2canvas 改为 CDN 外置（`@require`），产物由 ~530KB 降至 ~23KB。
