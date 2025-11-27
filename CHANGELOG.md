# Changelog

本文件记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

### 变更

### 弃用

### 移除

### 修复

### 安全

---

## [1.6.0] - 2025-11-27

### 新增

- **Next.js 16 和 React 19 支持**：升级到最新的 Next.js 和 React 版本
  - Next.js 从 14.2.0 升级到 16.0.5
  - React 和 React-DOM 从 18.3.1 升级到 19.2.0
  - 添加 Turbopack 配置支持（Next.js 16 默认构建工具）
- **ESLint 9 Flat Config 支持**：迁移到新的 ESLint 配置格式
  - 从 `.eslintrc.json` 迁移到 `eslint.config.mjs`（Flat Config）
  - 添加 `typescript-eslint` 支持
  - 更新 lint 脚本为 `eslint .`

### 变更

- **依赖升级**：更新多个核心依赖到最新版本
  - react-pdf: 9.1.0 → 10.2.0
  - electron: 38.2.1 → 39.2.4
  - lucide-react: 0.544.0 → 0.555.0
  - iconv-lite: 0.6.3 → 0.7.0
  - TypeScript: 5.4.5 → 5.8.0
  - ESLint: 8.57.1 → 9.28.0
  - eslint-config-next: 14.2.33 → 16.0.0
  - tailwindcss: 3.4.1 → 3.4.17
  - postcss: 8.4.38 → 8.5.0
  - autoprefixer: 10.4.19 → 10.4.20
- **TypeScript 配置优化**：更新 `tsconfig.json`
  - JSX 设置从 `preserve` 改为 `react-jsx`（React 19 推荐）
  - 添加 `.next/dev/types/**/*.ts` 到 include 路径
- **react-pdf CSS 导入路径更新**：适配 react-pdf 10.x 版本
  - 从 `react-pdf/dist/esm/Page/*.css` 改为 `react-pdf/dist/Page/*.css`
- **PDFViewer 动态导入**：使用 `next/dynamic` 禁用 SSR
  - 解决 react-pdf 需要浏览器 API 的问题
  - 添加加载占位符提升用户体验
- **PDF API 路由优化**：改进文件查找逻辑
  - 支持包含斜杠的文件名（如 `北京/首都.pdf`）
  - 自动尝试多种文件名格式（下划线、斜杠、无分隔符）
  - 修复 Next.js 16 中 params 为 Promise 的 API 变更
- **机场细则文件名处理**：改进 `getPDFFileName()` 函数
  - 将文件名中的斜杠替换为下划线，避免路径解析问题
  - 自动去除文件名首尾空格

### 移除

- **删除旧版 ESLint 配置**：移除 `.eslintrc.json` 文件

---

## [1.5.4] - 2025-11-27

### 修复

- **修复 ESLint 构建错误**：解决生产构建失败问题
  - 移除 `app/api/charts/route.ts:93` 中未使用的 error 变量
  - 修复 TypeScript ESLint 规则 `@typescript-eslint/no-unused-vars` 错误
  - 确保生产构建通过所有代码质量检查

---

## [1.5.3] - 2025-11-27

### 变更

- **增强图表加载容错性**：改进图表目录读取逻辑
  - 优先从 `csvDirectory` 加载图表数据
  - 当 `csvDirectory` 中未找到图表时，自动尝试从 `chartsDirectory` 加载
  - 添加详细日志输出，便于排查数据加载问题
  - 提高系统在不同配置环境下的适应性

### 修复

- **修复代码格式问题**：改进 `ChartList.tsx` 中跑道提取函数的代码缩进
  - 统一旧格式跑道解析逻辑的缩进层级
  - 提升代码可读性和维护性

---

## [1.5.2] - 2025-11-26

### 修复

- **支持新的 CSV 图表名称格式**：兼容已格式化的图表名称
  - 旧格式（无空格）：`RNPILSDMEzRW24`、`RNAVRWY0136L`
  - 新格式（有空格）：`RNP ILS/DME z RW24`、`RNAV RWY 01/36L`
  - 自动检测图表名称格式，智能选择处理方式
  - 新格式数据直接使用，仅做必要的清理和标准化
  - 旧格式数据继续使用原有格式化逻辑
  - 完美向后兼容，支持新旧格式混合使用

### 变更

- **图表名称格式化逻辑优化**：改进 `chartFormatter.ts`
  - 新增 `isAlreadyFormatted()` 函数检测图表名称格式
  - `formatAppChartName()` 和 `formatSidStarChartName()` 支持新格式
  - 新格式 APP 图表：移除跑道信息（RW/RWY），标准化后缀字母为大写
  - 新格式 SID/STAR 图表：保持原样，仅清理多余空格
- **跑道提取逻辑优化**：改进 `ChartList.tsx` 中的 `extractRunways()` 函数
  - 新格式支持：解析 `RW 24`、`RWY 01/36L/36R` 等格式（斜杠分隔）
  - 旧格式支持：继续解析 `RWY0136L36R` 等格式（连续数字）
  - 确保跑道分组和筛选功能在新旧格式下都正常工作

---

## [1.5.1] - 2025-11-24

### 修复

- **修复 ESLint 代码规范问题**：解决所有 TypeScript/ESLint 警告和错误
  - 移除未使用的 error 变量（7 处，涉及 API 路由和配置管理）
  - 移除未使用的 err 变量（4 处，涉及设置模态框）
  - 移除未使用的 containerWidth 和 paddingX 变量（PDF 查看器）
  - 移除未使用的 suffixAlreadyAdded 变量（图表格式化器）
  - 修复 any 类型使用：使用正确的 PDFPageProxy 类型替代 any 类型
  - 所有文件通过 ESLint 严格检查，无警告无错误

---

## [1.5.0] - 2025-11-24

### 新增

- **支持新的图表数据格式**：自动识别并支持两种 CSV 数据组织方式
  - 传统格式：单一 Charts.csv 文件包含所有机场图表数据
  - 新格式：按机场分目录，每个机场目录下有独立的 Charts.csv
  - 自动格式检测，无需手动配置
  - 完美向后兼容旧格式数据

### 变更

- **优化图表数据加载逻辑**：改进 CSV 解析和数据处理流程
  - 新增 `parsePerAirportCSV()` 函数解析新格式数据
  - 新增 `parseAirportsCSV()` 函数解析机场信息
  - 统一数据结构，新旧格式输出相同的 ChartData 格式
- **改进格式检测算法**：智能识别数据目录格式
  - 检测 Charts.csv 内容判断是否为新格式
  - 新格式自动遍历机场目录加载所有图表
  - 提供详细日志便于排查问题
- **字段映射优化**：新格式字段自动转换为标准格式
  - `IS_SUP: "True"/"False"` → `"Y"/"N"`
  - `IsModify: "True"/"False"` → `IS_MODIFIED: "Y"/"N"`

### 修复

- **修复图表书签功能**：解决新格式下所有图表被错误标记为收藏的问题
  - 为新格式数据生成唯一 ChartId（基于机场代码和页码）
  - ChartId 格式：`{AirportIcao}-{PAGE_NUMBER}` 或 `{AirportIcao}-{ChartName}`
  - 确保每个图表都有唯一标识符，书签系统正常工作
  - 保持与旧格式 ChartId 结构的一致性

---

## [1.4.0] - 2025-11-15

### 修复

- **修复中文文件名 PDF 加载失败问题**：解决机场细则等中文命名图表无法加载的关键问题
  - 修复 PDF API 路由对非 ICAO 格式文件名（如"北京首都.pdf"）的查找逻辑
  - 原有查找机制仅支持 ICAO-前缀格式（如"ZBAA-2A.pdf"），无法定位中文文件名
  - 新增回退搜索机制：当标准匹配失败时，自动遍历所有机场子目录查找文件
  - 支持三种文件组织格式：
    - 扁平结构：`charts/filename.pdf`
    - ICAO 嵌套结构：`charts/ZBAA/ZBAA-2A.pdf`
    - 中文文件名嵌套结构：`charts/ZBAA/北京首都.pdf`
  - 确保所有类型的图表文件都能正确加载，无论文件名格式如何

### 变更

- **优化 PDF 文件查找算法**：改进文件定位逻辑的鲁棒性和容错性
  - 查找顺序：ICAO 前缀匹配 → 扁平目录 → 遍历所有子目录
  - 提升对不同文件组织方式的兼容性
  - 改善错误处理和日志记录

---

## [1.3.3] - 2025-10-30

### 变更

- **UI 一致性优化**：统一整个应用的界面设计风格
  - 标准化按钮悬停状态：所有按钮使用统一的悬停颜色（`hover:bg-gray-200 dark:hover:bg-gray-800`）
  - 统一按钮圆角样式：所有交互按钮使用 `rounded-lg` 圆角
  - 语言一致性改进：将所有界面文本统一为英文
- **ThemeToggle 组件**：
  - 工具提示从中文改为英文（"Switch to Light Mode" / "Switch to Dark Mode"）
  - 按钮圆角从 `rounded` 改为 `rounded-lg`，与其他按钮保持一致
- **UpdateNotification 组件**：
  - 所有界面文本从中文改为英文
  - 标题文本：`"新版本可用"` → `"New Update Available"`，`"更新检查错误"` → `"Update Check Failed"`
  - 按钮文本：`"前往 GitHub 下载更新"` → `"Download Update on GitHub"`
  - 按钮圆角从 `rounded-md` 改为 `rounded-lg`
- **SettingsModal 组件**：
  - 标准化 4 个按钮的悬停状态（关闭按钮、父目录按钮、子目录按钮、取消按钮）
  - 所有按钮悬停效果现在一致

---

## [1.3.2] - 2025-10-17

### 新增

- **代码格式化工具**：添加 Prettier 支持，确保代码风格一致
  - 安装 Prettier 作为开发依赖
  - 添加 `.prettierrc` 配置文件（80 字符行宽、双引号、2 空格缩进等）
  - 添加 `.prettierignore` 文件排除构建输出和依赖目录
  - 新增格式化脚本：`npm run format` 和 `npm run format:check`

---

## [1.3.1] - 2025-10-16

### 变更

- **图表列表布局优化**：改进图表列表按钮的间距和文本显示
  - 图表按钮添加右侧内边距（pr-12），防止文本与书签图标重叠
  - 图表名称添加 `wrap-break-word` 样式，正确处理长文本换行
- **PDF 查看器移动端优化**：提升移动设备上的控制按钮可用性
  - 缩放控制按钮在所有屏幕尺寸上可见（之前仅在平板及以上显示）
  - 移动设备上缩放按钮和文字使用更小尺寸（图标 3.5px，文字 10px）
  - 自动适配按钮在所有屏幕尺寸上可见
  - 书签导航显示当前位置信息（例如："1 / 3"）
  - 书签导航仅在平板（iPad）及以上设备显示，手机端隐藏以节省空间
  - 优化控制按钮间距，改善移动端触控体验

---

## [1.3.0] - 2025-10-16

### 新增

- **图表书签功能**：为每个图表添加书签/收藏功能
  - 每个图表右上角显示圆形书签按钮（空心圆圈/绿色对勾）
  - 点击书签按钮可添加或移除书签
  - 支持为不同分类的图表添加书签
  - 书签状态在切换机场时保持
- **智能分类跳转**：点击分类按钮自动跳转到书签图表
  - 首次点击分类：如有书签图表，自动跳转并显示
  - 再次点击分类：打开图表列表以选择其他图表
  - 无书签图表时：直接打开图表列表
  - 优先显示最近书签的图表
- **书签导航按钮**：PDF 查看器工具栏新增书签导航功能
  - 当有 2 个或以上书签图表时显示导航按钮
  - 显示书签图标和书签总数
  - 前一个/后一个书签按钮快速切换
  - 支持跨分类浏览所有书签图表
  - 循环导航：最后一个书签后跳转到第一个
- **自动书签机场图**：切换机场时自动书签机场图
  - 加载应用时自动书签首个机场的机场图
  - 切换到新机场时自动书签该机场的机场图（通常为 2A 或 0G 页）
  - 自动查找逻辑：优先精确匹配"机场图"，其次匹配页码 2A/0G，再次部分匹配包含"机场图"的图表
  - 确保每个机场的机场图始终在书签列表中
- **自动跳转机场图**：切换机场时自动显示机场图
  - 选择新机场时自动查找并显示该机场的机场图
  - 提供快速参考，无需手动查找
  - 智能匹配算法确保找到正确的机场图

### 变更

- 图表列表项布局调整，为书签按钮预留空间
- 书签按钮使用半透明背景，悬停时高亮显示
- 分类按钮点击逻辑优化，提供更智能的用户体验
- PDF 查看器工具栏布局优化，书签导航按钮位于右侧独立区域
- 书签图标使用 `lucide-react` 图标库：`Circle`（未书签）和 `CheckCircle2`（已书签）

---

## [1.2.2] - 2025-10-16

### 新增

- **外部链接在系统浏览器中打开**：添加 `openExternal` API 支持在默认浏览器中打开链接
  - 主页和设置页面的 GitHub 链接现在在 Electron 环境中会在系统默认浏览器中打开
  - 更新通知中的 GitHub Release 链接也使用系统浏览器打开
  - 提供更好的用户体验，避免在应用内打开外部链接
- **独立跑道格式支持**：图表名称格式化功能增强，支持独立 RWY 格式
  - 自动格式化 `RWY09` → `RWY 09`
  - 自动格式化 `RWY18L` → `RWY 18L`
  - 支持多跑道格式：`RWY0136L36R` → `RWY 01/36L/36R`

### 变更

- 主页和设置页面中的 GitHub 链接从 `<a>` 标签改为 `<button>` 元素
  - 在 Electron 环境中使用 `electronAPI.openExternal()` 打开链接
  - 在 Web 环境中继续使用 `window.open()` 作为后备方案
- electron/main.js 添加 `shell` 模块导入和 `open-external` IPC 处理器
- electron/preload.js 向渲染进程暴露 `openExternal` 方法
- types/electron.d.ts 更新类型定义，添加 `openExternal` 方法签名

---

## [1.2.1] - 2025-10-15

### 修复

- **修复 PDF 容器尺寸计算精度问题**：优化 PDF 渲染容器的尺寸计算
  - 使用 `Math.ceil()` 对尺寸进行向上取整，避免浮点数误差导致的显示问题
  - 为容器宽高添加 16px 内边距，确保 PDF 完整显示不被裁剪
  - 调整 PDF 内层容器的定位偏移（top: 2px, left: 2px），改善边缘对齐
  - 修复在某些缩放比例下 PDF 边缘被裁剪或显示不完整的问题

---

## [1.2.0] - 2025-10-14

### 新增

- **SID/STAR 图表名称格式化**：为 SID 和 STAR 图表添加智能名称格式化功能
  - 自动在程序类型（RNP/RNAV/ILS/VOR/NDB/LOC）和跑道之间添加空格
  - 使用斜杠分隔多个跑道号（例如：`0136L36R` → `01/36L/36R`）
  - 自动分割连续航点名称（例如：`GUVBAOSUBA` → `GUVBA/OSUBA`）
  - 示例：`RNAVRWY0136L36R(GUVBAOSUBA)` → `RNAV RWY 01/36L/36R (GUVBA/OSUBA)`
- **自动隐藏滚动条**：为 ChartList、SettingsModal 和 Sidebar 组件实现自动隐藏滚动条
  - 滚动条仅在滚动时显示，提供更清爽的视觉体验
  - 停止滚动 1 秒后自动淡出隐藏
  - 支持平滑的过渡动画效果

### 变更

- **统一图表名称格式化**：PDF 查看器标题现在显示与图表列表相同的格式化名称
  - 创建共享工具文件 `lib/chartFormatter.ts` 统一格式化逻辑
  - PDFViewer 和 ChartList 组件使用相同的格式化函数
  - 确保整个应用的图表名称显示一致性
- **代码重构**：将图表格式化函数提取为独立模块，提高代码可维护性
  - `formatAppChartName()` - APP 图表名称格式化
  - `formatSidStarChartName()` - SID/STAR 图表名称格式化
  - `getFormattedChartName()` - 统一入口函数

---

## [1.1.13] - 2025-10-14

### 新增

- **自动隐藏滚动条**：优化 PDF 查看器的滚动条显示逻辑
  - 滚动条仅在滚动时显示，提供更清爽的视觉体验
  - 停止滚动 1 秒后自动淡出隐藏
  - 支持平滑的过渡动画效果
  - 横向和纵向滚动条均支持自动隐藏

### 修复

- **修复 auto 缩放模式下的滚动问题**
  - 在 auto 模式下禁用普通滚动（触摸板和鼠标滚轮），避免意外滚动
  - 保留 Ctrl/Cmd + 滚轮缩放功能，用户可以随时通过缩放退出 auto 模式
  - auto 模式下设置 `overflow: hidden`，不显示滚动条
- **修复 Electron 开发模式端口占用问题**
  - 修复 `electron-dev.js` 和 `electron/main.js` 重复启动 Next.js 服务器的问题
  - 添加端口占用检测，避免 "EADDRINUSE" 错误
  - 开发模式下如果服务器已运行，Electron 主进程会直接使用现有服务器

### 变更

- 优化 PDF 查看器交互逻辑：
  - auto 模式：禁用滚动，但允许 Ctrl/Cmd + 滚轮缩放
  - 手动模式：支持正常滚动和缩放
  - 改进用户体验，行为更符合预期

---

## [1.1.12] - 2025-10-14

### 变更

- **更新机制改为手动下载**：将自动更新功能改为引导用户手动下载更新
  - 所有平台（macOS、Windows、Linux）统一使用手动下载方式
  - 检测到新版本时显示通知，提供"前往 GitHub 下载更新"按钮
  - 点击按钮直接跳转到 GitHub Release 最新版本页面
  - 简化更新流程，避免自动下载可能遇到的各种问题（如校验失败、网络问题等）
- 简化 electron-updater 配置，仅保留版本检测功能

### 移除

- 移除自动下载更新功能（`downloadUpdate` IPC 方法和 `updater-download-update` IPC 处理器）
- 移除自动安装更新功能（`quitAndInstall` IPC 方法和 `updater-quit-and-install` IPC 处理器）
- 移除下载进度相关代码（`onDownloadProgress` 事件监听器和 UI 进度条）
- 移除更新已下载状态的 UI 和逻辑（`onUpdateDownloaded` 事件监听器）
- `UpdateNotification.tsx` 移除 `downloading`、`downloaded`、`progress`、`isMac` 状态
- `electron/main.js` 移除 `download-progress` 和 `update-downloaded` 事件监听
- `electron/preload.js` 移除 `downloadUpdate()` 和 `quitAndInstall()` 方法暴露
- `types/electron.d.ts` 移除 `ProgressInfo` 接口定义，更新 `ElectronAPI.updater` 接口

---

## [1.1.11] - 2025-10-11

### 修复

- **彻底修复 SHA512 checksum mismatch 自动更新错误**
- 修复 DMG 签名导致的 electron-updater 校验失败问题（禁用 DMG 签名，设置 `"sign": false`）
- 修复 Next.js 构建缓存在不同平台间共享导致的 SHA512 不一致（完全禁用构建缓存）
- 修复跨平台构建时 latest-\*.yml 文件不匹配问题（构建前清理所有临时文件）
- 根据 [Kilian Valkhof 的 Electron 公证指南](https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/) 和 [electron-builder issue #7724](https://github.com/electron-userland/electron-builder/issues/7724) 实施完整修复方案

### 变更

- 优化 GitHub Actions 构建流程：
  - 移除 Next.js 构建缓存策略，避免跨平台缓存导致的文件不一致
  - 添加构建前清理步骤（.next、dist、out 目录），确保每次都是干净的构建环境
  - 同时更新 `build.yml` 和 `pre-release.yml` 工作流
- 优化 macOS 构建配置：
  - 添加 `hardenedRuntime: false` 和 `gatekeeperAssess: false` 配置
  - 未签名的 DMG 可以包含已公证的 .app 而不触发 Gatekeeper 错误
- electron-updater 日志改进：
  - 添加详细的配置信息输出（provider、版本号、平台、架构）
  - SHA512 错误时提供更友好的错误消息和可能原因分析
  - 建议用户在更新失败时手动从 GitHub 下载

---

## [1.1.10] - 2025-10-11

### 修复

- 修复 GitHub Actions 缓存导致的 SHA512 校验失败问题，彻底解决自动更新 SHA512 不匹配
- 修复 Windows 端 "sha512 checksum mismatch" 错误
- 修复跨平台构建的 SHA512 一致性问题

### 变更

- 更新 Next.js 构建缓存策略，缓存 key 现在包含：
  - `package-lock.json`（依赖变化）
  - `package.json`（配置变化）
  - `public/**`（资源文件变化）
  - 代码文件（`.js`, `.jsx`, `.ts`, `.tsx`）
- 确保配置或资源文件变化时会重新构建，避免使用过期缓存
- 更新 `build.yml` 和 `pre-release.yml` 工作流
- macOS、Windows、Linux 三个平台的更新文件现在保证来自同一次构建

---

## [1.1.9] - 2025-10-11

### 新增

- 增强图标生成脚本，自动生成所有平台所需的图标格式
- Windows 平台添加 `.ico` 格式图标（包含 7 种尺寸：16, 24, 32, 48, 64, 128, 256）
- macOS 平台添加 `.icns` 格式图标（包含 10 种尺寸和 Retina 版本）
- 自动从 SVG 源文件生成所有格式
- 添加 `png-to-ico` 依赖用于 Windows 图标生成

### 修复

- 修复 Windows 应用图标缺失问题，Windows 版本现在正确显示应用图标
- 修复任务栏、开始菜单、桌面快捷方式图标显示问题

### 变更

- 更新 `.gitignore` 配置，允许提交 `icon.ico` 和 `icon.icns` 文件
- 更新 `package.json` 构建配置中的图标路径：
  - macOS: `public/icon.icns`
  - Windows: `public/icon.ico`
  - Linux: `public/icon.png`
- 图标生成脚本支持跨平台运行（macOS 上可生成 .icns，其他平台跳过）

---

## [1.1.8] - 2025-10-11

### 新增

- 更新通知组件新增平台检测功能，根据操作系统显示不同的更新方式
- macOS 平台显示"前往下载页面"按钮，引导用户到 GitHub Release 手动下载
- macOS 用户会看到安全限制提示信息

### 修复

- 修复 macOS 自动更新失败问题，避免 "code signature validation failed" 错误
- 修复 macOS 用户自动下载被系统阻止导致的混淆和错误提示

### 变更

- macOS 构建配置添加 `identity: null`，禁用代码签名
- 生成未签名的安装包，无需 Apple Developer 证书
- 适用于个人使用和内部分发场景
- 用户首次安装需在"系统设置 > 隐私与安全性"中手动允许
- macOS 用户改为手动下载更新，Windows 和 Linux 用户保持自动更新功能
- 使用 `navigator.platform` 检测操作系统平台

---

## [1.1.7] - 2025-10-07

### 修复

- 修复自动更新文件名不匹配问题，解决 auto-updater 404 错误
- 修复 electron-builder 在不同阶段处理空格不一致的问题
- 确保 `latest-mac.yml`、`latest.yml`、`latest-linux.yml` 中的文件名引用与实际构建产物完全匹配

### 变更

- 在所有平台（macOS、Windows、Linux）添加统一的 `artifactName` 配置
- 使用 `Chart.Viewer-${version}-${arch}.${ext}` 格式，避免空格导致的命名不一致
- 统一文件命名格式：
  - macOS: `Chart.Viewer-1.1.7-arm64-mac.zip` 和 `Chart.Viewer-1.1.7-arm64.dmg`
  - Windows: `Chart.Viewer-1.1.7-x64.exe` 和 `Chart.Viewer-1.1.7-x64-portable.exe`
  - Linux: `Chart.Viewer-1.1.7-x64.AppImage` 和 `Chart.Viewer-1.1.7-x64.deb`

---

## [1.1.6] - 2025-10-07

### 修复

- 修复 GitHub Release 文件上传冲突，解决 builder-debug.yml 重复上传导致的 404 错误
- 修复多平台构建时的文件名冲突问题
- 确保 Release 创建过程完全成功，无错误

### 变更

- 将 artifacts 上传路径从 `dist/*.yml` 改为 `dist/latest*.yml`
- 优化 artifacts 上传策略，只上传自动更新所需的配置文件（latest-mac.yml、latest.yml、latest-linux.yml）
- 排除调试文件 builder-debug.yml，避免三个平台生成同名文件导致冲突
- 同步更新 build.yml 和 pre-release.yml 工作流

---

## [1.1.5] - 2025-10-07

### 修复

- 修复 GitHub Actions 发布流程，确保自动更新功能完全可用
- 修复 electron-builder 与 GitHub Actions 的上传冲突问题
- 修复多平台并行构建时的上传冲突
- 确保 `latest-mac.yml`、`latest.yml` 等文件正确包含在 Release 中

### 变更

- 修改构建参数为 `--publish never`，生成更新文件但不自动上传
- 恢复 `release` job，统一创建 GitHub Release 并上传所有文件
- 完善构建发布流程：
  1. Build 阶段：使用 `--publish never` 生成所有文件（包括更新配置）
  2. Upload Artifacts：上传所有构建产物到 GitHub Actions
  3. Release 阶段：统一下载并发布到 GitHub Release
- 所有平台（macOS、Windows、Linux）都遵循相同的流程
- GitHub Actions 的 `release` job 使用 `softprops/action-gh-release` 创建 Release

---

## [1.1.4] - 2025-10-07

### 修复

- 修复 1.1.3 中缺少 release 步骤的问题
- 修复条件判断语法，使用 GitHub Actions 原生表达式

### 变更

- 重新启用 `release` job 来创建 GitHub Release
- GitHub Actions 条件判断从 bash 脚本改为 workflow 表达式
- 使用 `startsWith(github.ref, 'refs/tags/v')` 判断是否为 tag 推送
- 同步更新 `pre-release.yml` 工作流

### 弃用

- 此版本仍使用 `--publish always`，可能导致与手动 Release 冲突（已在 1.1.5 中修复）

---

## [1.1.3] - 2025-10-07

### 修复

- 修复 CI/CD 工作流以支持应用自动更新功能
- 修复 1.1.2 中自动更新功能无法正常工作的问题

### 变更

- 构建时添加 `--publish always` 参数，自动发布到 GitHub Release
- 确保生成自动更新所需的 `latest-mac.yml`、`latest.yml`、`latest-linux.yml` 配置文件
- 确保生成 `.blockmap` 文件用于增量更新
- electron-builder 现在自动创建 GitHub Release 并上传所有文件
- 移除手动创建 Release 的步骤，避免重复和冲突
- GitHub Actions 工作流优化（`.github/workflows/build.yml`）：
  - Tag 推送时自动使用 `--publish always` 发布到 GitHub Release
  - 非 Tag 构建仍然只构建不发布（用于 PR 测试）
  - 上传 artifacts 时包含 `.blockmap` 和 `.yml` 文件
  - 禁用手动 Release job，改用 electron-builder 自动发布
  - Windows 构建步骤添加 `shell: bash` 确保跨平台兼容性
- 预发布工作流优化（`.github/workflows/pre-release.yml`）：
  - 预发布版本（alpha/beta/rc）也支持自动更新
  - 构建时自动发布到 GitHub Pre-release
  - 包含所有自动更新所需文件
- 构建发布流程变化：
  - 之前：构建 → 上传 artifacts → 手动创建 Release → 上传文件
  - 现在：构建 → electron-builder 自动发布（一步完成）
- 生成的文件：
  - macOS: `.dmg`, `.zip`, `.zip.blockmap`, `latest-mac.yml`
  - Windows: `.exe`, `.exe.blockmap`, `latest.yml`
  - Linux: `.AppImage`, `.deb`, `latest-linux.yml`
- 自动更新检测流程：
  1. 应用读取 GitHub Release 中的 `latest-mac.yml`
  2. 对比版本号，发现新版本
  3. 下载 `.zip` 文件（使用 `.blockmap` 实现增量下载）
  4. 验证签名和 SHA-512 哈希
  5. 安装新版本

---

## [1.1.2] - 2025-10-07

### 新增

- 应用自动更新功能，通过 GitHub Release 实现自动更新机制
- 应用启动时自动检查 GitHub Release 是否有新版本
- 发现新版本时显示更新通知，支持一键下载
- 下载完成后提示重启安装，无需手动操作
- 更新通知 UI 显示版本号、发布说明和下载进度
- 支持关闭更新通知，不影响正常使用
- UpdateNotification 组件，全新的更新通知 UI 组件：
  - 显示在屏幕右下角，不遮挡主要内容
  - 实时显示下载进度条（百分比）
  - 支持亮色/暗色主题自动适配
  - 完整的错误处理和提示信息
- 更新相关 API，为渲染进程暴露完整的更新控制接口：
  - `checkForUpdates()`：手动检查更新
  - `downloadUpdate()`：下载更新
  - `quitAndInstall()`：退出并安装更新
  - 事件监听器：`onUpdateAvailable`、`onDownloadProgress`、`onUpdateDownloaded` 等
- TypeScript 类型定义（`types/electron.d.ts`）：
  - `UpdateInfo` 接口：定义更新信息结构
  - `ProgressInfo` 接口：定义下载进度数据结构
  - 扩展 `ElectronAPI` 接口包含 updater 方法

### 变更

- package.json 构建配置添加 GitHub 发布配置，配置 `publish` 字段指向 GitHub Repository
- electron-builder 自动将构建产物上传到 GitHub Release
- electron/main.js 集成 electron-updater 模块：
  - 引入 `electron-updater` 自动更新器
  - 添加 `setupAutoUpdater()` 函数处理更新逻辑
  - 应用启动 5 秒后自动检查更新（生产环境）
  - 所有更新事件通过 IPC 发送到渲染进程
  - 新增 3 个 IPC 处理器：`updater-check-for-updates`、`updater-download-update`、`updater-quit-and-install`
- electron/preload.js 扩展 electronAPI 接口：
  - 添加 `updater` 对象，包含更新相关的所有方法
  - 支持单向和双向 IPC 通信
  - 返回清理函数用于移除事件监听器
- app/layout.tsx 在根布局中引入 UpdateNotification 组件，全局可用，仅在 Electron 环境中激活
- 使用 `electron-updater` 库实现自动更新（基于 Squirrel）
- 更新源配置为 GitHub Release (provider: github)
- `autoDownload` 设为 false，由用户手动触发下载
- `autoInstallOnAppQuit` 设为 true，退出时自动安装
- 开发环境禁用自动更新功能，避免干扰开发
- 更新文件（latest-mac.yml）由 electron-builder 自动生成
- 支持增量更新，仅下载变更部分（通过 blockmap）
- 完整的错误处理和日志记录

### 安全

- electron-updater 自动验证下载文件的签名和 SHA-512 哈希
- 仅通过 HTTPS 从 GitHub 下载更新文件
- 签名验证确保更新文件未被篡改

---

## [1.1.1] - 2025-10-07

### 新增

- 鼠标拖动航图功能，在非自动适配模式下可以使用鼠标拖动移动 PDF
- 点击并拖动即可移动航图查看不同区域
- 自动限制在 PDF 边界内，不会超出范围
- 拖动时显示"抓手"光标，提供视觉反馈
- 拖动时自动防止文本被意外选中
- 不会干扰按钮和链接的正常点击

### 修复

- 修复 Auto 模式下 PDF 不在正中央的问题
- PDF 现在完美居中显示

### 变更

- 统一 PDF 渲染架构，Auto 模式和手动缩放模式现在使用相同的双层缩放架构
- Auto 模式也使用高清 renderScale 渲染，然后通过 CSS transform 缩放到适配尺寸
- 大幅提升 Auto 模式下的 PDF 清晰度（提升 100-300%）
- 代码逻辑更统一，便于维护和未来优化
- Auto 模式下动态计算最佳渲染倍率：
  - 根据窗口大小自动计算 autoFitScale
  - renderScale 动态调整为 fitScale 的 1.5 倍，范围 2.0x-4.0x
  - 确保放大查看时始终保持高清晰度
- devicePixelRatio 从固定值改为动态检测：
  - 自动适配 Retina 等高 DPI 屏幕
  - 使用 `Math.max(window.devicePixelRatio || 1, 2)` 确保至少 2 倍渲染
  - 在高分辨率屏幕上显示更加清晰
- 容器尺寸变化时自动重新计算渲染参数：
  - 调整窗口大小时自动更新 autoFitScale 和 renderScale
  - 保持最佳显示效果和清晰度
- 外层容器改为 auto 尺寸，配合 flex 布局居中
- 内层容器缩放原点从 `top left` 改为 `center center`
- Auto 模式渲染流程：高清渲染 (2-4x) → CSS transform 缩放 → 居中显示
- 拖动功能使用容器的 scrollLeft/scrollTop 控制，浏览器自动处理边界
- transform origin 根据模式动态调整：Auto 使用 center，手动使用 top left
- 窗口尺寸监听使用 ResizeObserver，依赖 autoFit 和 pageHeight 状态

---

## [1.1.0] - 2025-10-07

### 新增

- **版权信息和 GitHub 链接**：在多个位置添加版权声明和项目链接
  - package.json 中添加 repository、homepage 和 bugs 字段
  - README.md 底部添加完整的版权信息、GitHub 链接和作者信息
  - Settings 模态框中添加"关于"部分，显示版本号、版权声明和 GitHub 链接
  - 主页面空状态下显示版权信息和 GitHub 仓库链接

### 修复

- **Settings 页面滚动问题**：移除 Settings 模态框的滚动功能
  - 移除最大高度限制（max-h-[90vh]）
  - 移除垂直滚动（overflow-y-auto）
  - 模态框现在根据内容自动调整大小，不会出现滚动条

### 变更

- 更新 MIT License 版权年份为 2025
- 优化 Settings 模态框布局，改善用户体验

---

## [1.0.9] - 2025-10-06

### 新增

- 鼠标滚轮缩放功能，按住 Ctrl（Windows/Linux）或 Cmd（Mac）+ 滚轮即可缩放 PDF
- 支持 0.5x 到 3.0x 的缩放范围
- 智能延迟重渲染机制，缩放时使用 CSS transform 保持流畅
- 停止缩放 500ms 后自动以最佳质量重新渲染
- 工具栏提示显示快捷键操作方式

### 变更

- 优化 PDF 渲染策略，引入动态渲染比例系统
- 基础渲染比例从固定值改为动态计算（1.5x 到 3.0x）
- 根据当前缩放级别智能调整渲染质量
- 缩放时使用 CSS transform 实现即时响应
- 减少不必要的重渲染，提升性能和流畅度
- 改进用户体验，打开机场下拉菜单时自动关闭已打开的图表分类列表
- 避免界面元素重叠，提供更清晰的导航流程
- PDF 缩放使用双层结构：外层容器控制滚动区域，内层应用 CSS transform
- 智能重渲染使用防抖机制，避免频繁重新渲染
- 渲染比例动态优化：放大时提高渲染质量，缩小时降低以节省内存
- 页面切换时重置页面尺寸以确保正确布局
- 所有缩放操作（按钮、滚轮、快捷键）共享统一的缩放逻辑

---

## [1.0.8] - 2025-10-05

### 新增

- 完整的主题切换系统，为整个应用添加亮色和暗色主题切换功能
- 主题切换按钮集成在 Sidebar 底部
- 支持亮色模式、暗色模式和跟随系统
- 所有组件完美适配两种主题
- PDF 颜色反转（黑暗模式），PDF 内容自动跟随主题进行颜色反转
- 暗色主题下 PDF 自动反转颜色，减少眼睛疲劳
- 亮色主题下 PDF 保持原始外观，无需额外按钮，自动同步

### 修复

- 修复主题切换按钮样式未适配主题的问题
- 修复 PDF 边框过强的阴影效果，改为更柔和的阴影

### 变更

- 统一 UI 风格，ChartList 采用与 Sidebar 一致的深色主题设计
- 背景：亮色模式使用浅灰色，暗色模式使用深灰色
- 按钮和卡片样式统一，改善视觉一致性和层次感
- 优化主题默认设置，默认主题从固定暗色改为跟随系统（`system`）
- 提升 PDF 渲染质量，大幅提高自动适配模式下的 PDF 清晰度
- 像素密度提升至至少 3x
- 添加字体平滑和 GPU 加速
- 文字和线条更加锐利清晰
- 使用 `next-themes` 实现主题切换
- PDF 颜色反转使用 CSS `filter: invert(1) hue-rotate(180deg)`
- PDF 渲染使用 `devicePixelRatio: Math.max(window.devicePixelRatio || 2, 3)`
- 添加 CSS 渲染优化：`-webkit-font-smoothing`、`transform: translateZ(0)` 等

---

## [1.0.7] - 2025-10-05

### 新增

- **智能图表目录格式支持**：自动检测并支持两种图表目录结构
  - 扁平结构：所有图表文件在同一目录下
  - 嵌套结构：按机场 ICAO 代码组织子目录
- **跑道筛选功能**：在图表列表中新增跑道筛选按钮，可快速筛选特定跑道的图表
- **分类切换优化**：点击已选中的分类可取消选择，提升用户体验

### 变更

- **PDF 文件查找逻辑**：优化文件查找算法，优先尝试嵌套格式，失败时自动回退到扁平格式
- **跑道标签显示**：将跑道标签从"跑道 XX"改为"RWY XX"，更符合航空标准
- **文档更新**：README 中新增图表目录格式说明和使用指南

### 修复

- 修复图表文件在不同目录结构下的查找问题
- 优化文件路径解析，提高 PDF 加载成功率

---

## [1.0.6] - 2025-10-05

### 修复

- 修复 Electron 打包后空白页面问题，应用在打包后无法正常显示的关键问题
- 修复配置文件无法保存问题，配置现在保存到用户数据目录而非只读的应用包内
- 修复生产环境 Next.js 服务器启动失败（ENOTDIR 错误）

### 变更

- 重构 Electron 生产环境架构，在打包应用中内嵌 Next.js 服务器而非使用静态文件
- 更新打包配置，打包 `.next/` 目录而非不存在的 `out/` 目录
- 生产环境使用 Next.js Node.js API 启动服务器，支持所有 API Routes
- 配置文件路径改为使用 Electron userData 目录（macOS: `~/Library/Application Support/Chart Viewer/config.json`）
- 添加动态端口分配以避免端口冲突
- 优化 Next.js 配置，启用压缩和性能优化
- 生产环境现在通过 `require('next')` 编程方式启动服务器
- 应用启动时会在后台启动本地 HTTP 服务器（约 2-4 秒）
- 支持完整的 Next.js 功能：API Routes、动态路由、服务器端渲染
- 环境变量 `USER_DATA_PATH` 用于指定配置文件位置

---

## [1.0.5] - 2025-10-05

### 修复

- 修复 GitHub Actions 工作流权限以允许创建发布版本

### 变更

- 为 GitHub Actions 工作流添加 contents: write 权限

---

## [1.0.4] - 2025-10-05

### 修复

- 修复 ThemeProvider 中 next-themes 类型导入错误
- 移除静态导出配置以支持 API 路由正常工作
- 升级 Node.js 要求至 22.0.0+ 以支持 Promise.withResolvers API
- 配置主页为动态渲染以避免构建时预渲染错误
- 添加 package.json 中缺失的 author 和 description 字段以支持 Linux .deb 包构建

### 变更

- 更新 GitHub Actions 工作流使用 Node.js 22

---

## [1.0.3] - 2025-10-05

### 新增

- GitHub Actions 自动构建和发布流程
- 跨平台安装包支持（macOS、Windows、Linux）
- 发布脚本工具

### 变更

- 更新 Next.js 配置以支持静态导出
- 将 charts 和 csv 文件夹添加到 .gitignore

---

## [1.0.2] - 2025-10-05

### 变更

- 项目版本调整

---

## [1.0.1] - 2025-10-05

### 变更

- 项目版本调整

---

## [1.0.0] - 2025-10-05

### 新增

- 初始版本
- PDF 图表查看器
- 图表列表和搜索功能
- 侧边栏导航
- 主题切换功能
- 设置模态框
- Electron 桌面应用支持

---

## 关于本变更日志

### 什么是变更日志？

变更日志是一个文件，它包含项目每个版本的重要变更的精心整理、按时间排序的列表。

### 为什么要维护变更日志？

为了让用户和贡献者能够准确了解项目每个版本之间有哪些重要变更。

### 变更类型

- **新增**：新功能
- **变更**：现有功能的变化
- **弃用**：即将移除的功能
- **移除**：已移除的功能
- **修复**：Bug 修复
- **安全**：安全漏洞相关的修复

### 版本号规则

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/) **主版本号.次版本号.修订号** (例如 1.2.3)：

- **主版本号**：重大变更，可能不向后兼容
- **次版本号**：新增功能，向后兼容
- **修订号**：问题修复，向后兼容

### 预发布版本

- **alpha**：早期测试版本，功能不完整
- **beta**：功能完整，但可能有问题
- **rc**：候选发布版本，准备正式发布

[未发布]: https://github.com/6639835/chart-viewer/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/6639835/chart-viewer/compare/v1.5.4...v1.6.0
[1.5.4]: https://github.com/6639835/chart-viewer/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/6639835/chart-viewer/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/6639835/chart-viewer/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/6639835/chart-viewer/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/6639835/chart-viewer/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/6639835/chart-viewer/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/6639835/chart-viewer/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/6639835/chart-viewer/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/6639835/chart-viewer/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/6639835/chart-viewer/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/6639835/chart-viewer/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/6639835/chart-viewer/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/6639835/chart-viewer/compare/v1.1.13...v1.2.0
[1.1.13]: https://github.com/6639835/chart-viewer/compare/v1.1.12...v1.1.13
[1.1.12]: https://github.com/6639835/chart-viewer/compare/v1.1.11...v1.1.12
[1.1.11]: https://github.com/6639835/chart-viewer/compare/v1.1.10...v1.1.11
[1.1.10]: https://github.com/6639835/chart-viewer/compare/v1.1.9...v1.1.10
[1.1.9]: https://github.com/6639835/chart-viewer/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/6639835/chart-viewer/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/6639835/chart-viewer/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/6639835/chart-viewer/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/6639835/chart-viewer/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/6639835/chart-viewer/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/6639835/chart-viewer/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/6639835/chart-viewer/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/6639835/chart-viewer/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/6639835/chart-viewer/compare/v1.0.9...v1.1.0
[1.0.9]: https://github.com/6639835/chart-viewer/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/6639835/chart-viewer/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/6639835/chart-viewer/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/6639835/chart-viewer/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/6639835/chart-viewer/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/6639835/chart-viewer/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/6639835/chart-viewer/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/6639835/chart-viewer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/6639835/chart-viewer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/6639835/chart-viewer/releases/tag/v1.0.0
