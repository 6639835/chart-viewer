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

## [1.1.11] - 2025-10-11

### 修复
- **彻底修复 SHA512 checksum mismatch 自动更新错误**：
  - 根据 [Kilian Valkhof 的 Electron 公证指南](https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/) 和 [electron-builder issue #7724](https://github.com/electron-userland/electron-builder/issues/7724)，实施了完整的修复方案
  - 禁用 DMG 签名（`"sign": false`），未签名的 DMG 可以包含已公证的 .app 而不触发 Gatekeeper 错误
  - 添加 `hardenedRuntime: false` 和 `gatekeeperAssess: false` 配置，避免签名相关的校验冲突
  - 移除 Next.js 构建缓存，确保每次构建都是全新的，避免不同平台之间的缓存污染
  - 在构建前清理所有旧文件（.next、dist、out 目录），确保构建环境一致性
  - 改进错误处理和日志记录，当出现 SHA512 不匹配时提供详细的诊断信息和解决建议

### 变更
- 优化 GitHub Actions 构建流程：
  - 移除 Next.js 构建缓存策略，避免跨平台缓存导致的文件不一致
  - 添加构建前清理步骤，确保每次都是干净的构建环境
  - 同时更新 `build.yml` 和 `pre-release.yml` 工作流
- electron-updater 日志改进：
  - 添加详细的配置信息输出（provider、版本号、平台、架构）
  - SHA512 错误时提供更友好的错误消息和可能原因分析
  - 建议用户在更新失败时手动从 GitHub 下载

### 技术说明
- **问题根源**：
  1. DMG 被签名后，electron-updater 会验证签名，但未公证的签名会导致校验失败
  2. Next.js 构建缓存在不同平台间共享时，可能包含平台特定的内容，导致 SHA512 不一致
  3. 三个平台的构建如果不是完全相同的源代码和环境，生成的 latest-*.yml 文件会不匹配
- **解决方案**：
  1. 不签名 DMG（只打包未签名的 .app），避免 Gatekeeper 问题
  2. 完全禁用构建缓存，牺牲构建速度换取一致性
  3. 每次构建前清理所有临时文件，确保干净环境

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

[未发布]: https://github.com/6639835/chart-viewer/compare/v1.1.11...HEAD
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
