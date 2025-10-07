# Changelog

所有值得注意的项目更改都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

### 变更

### 修复

### 删除

---

## [1.1.3] - 2025-10-07

### 修复
- **GitHub Actions 自动更新支持**：修复 CI/CD 工作流以支持应用自动更新功能
  - 构建时添加 `--publish always` 参数，自动发布到 GitHub Release
  - 确保生成自动更新所需的 `latest-mac.yml`、`latest.yml` 等配置文件
  - 确保生成 `.blockmap` 文件用于增量更新
  - electron-builder 现在自动创建 GitHub Release 并上传所有文件
  - 移除手动创建 Release 的步骤，避免重复和冲突

### 变更
- **GitHub Actions 工作流优化** (`.github/workflows/build.yml`)
  - Tag 推送时自动使用 `--publish always` 发布到 GitHub Release
  - 非 Tag 构建仍然只构建不发布（用于 PR 测试）
  - 上传 artifacts 时包含 `.blockmap` 和 `.yml` 文件
  - 禁用手动 Release job，改用 electron-builder 自动发布
  - Windows 构建步骤添加 `shell: bash` 确保跨平台兼容性
- **预发布工作流优化** (`.github/workflows/pre-release.yml`)
  - 预发布版本（alpha/beta/rc）也支持自动更新
  - 构建时自动发布到 GitHub Pre-release
  - 包含所有自动更新所需文件

### 技术细节
- **构建发布流程变化**：
  - 之前：构建 → 上传 artifacts → 手动创建 Release → 上传文件
  - 现在：构建 → electron-builder 自动发布（一步完成）
- **生成的文件**：
  - macOS: `.dmg`, `.zip`, `.zip.blockmap`, `latest-mac.yml`
  - Windows: `.exe`, `.exe.blockmap`, `latest.yml`
  - Linux: `.AppImage`, `.deb`, `latest-linux.yml`
- **自动更新检测流程**：
  1. 应用读取 GitHub Release 中的 `latest-mac.yml`
  2. 对比版本号，发现新版本
  3. 下载 `.zip` 文件（使用 `.blockmap` 实现增量下载）
  4. 验证签名和 SHA-512 哈希
  5. 安装新版本

### 重要提示
- 此版本修复了 1.1.2 中自动更新功能无法正常工作的问题
- 如果已安装 1.1.2，需要手动下载 1.1.3 安装
- 从 1.1.3 开始，所有后续版本都可以自动更新

---

## [1.1.2] - 2025-10-07

### 新增
- **应用自动更新功能**：通过 GitHub Release 实现自动更新机制
  - 应用启动时自动检查 GitHub Release 是否有新版本
  - 发现新版本时显示更新通知，支持一键下载
  - 下载完成后提示重启安装，无需手动操作
  - 更新通知 UI 显示版本号、发布说明和下载进度
  - 支持关闭更新通知，不影响正常使用
- **UpdateNotification 组件**：全新的更新通知 UI 组件
  - 显示在屏幕右下角，不遮挡主要内容
  - 实时显示下载进度条（百分比）
  - 支持亮色/暗色主题自动适配
  - 完整的错误处理和提示信息
- **更新相关 API**：为渲染进程暴露完整的更新控制接口
  - `checkForUpdates()`: 手动检查更新
  - `downloadUpdate()`: 下载更新
  - `quitAndInstall()`: 退出并安装更新
  - 事件监听器：`onUpdateAvailable`、`onDownloadProgress`、`onUpdateDownloaded` 等

### 变更
- **package.json 构建配置**：添加 GitHub 发布配置
  - 配置 `publish` 字段指向 GitHub Repository
  - electron-builder 自动将构建产物上传到 GitHub Release
- **electron/main.js**：集成 electron-updater 模块
  - 引入 `electron-updater` 自动更新器
  - 添加 `setupAutoUpdater()` 函数处理更新逻辑
  - 应用启动 5 秒后自动检查更新（生产环境）
  - 所有更新事件通过 IPC 发送到渲染进程
  - 新增 3 个 IPC 处理器：`updater-check-for-updates`、`updater-download-update`、`updater-quit-and-install`
- **electron/preload.js**：扩展 electronAPI 接口
  - 添加 `updater` 对象，包含更新相关的所有方法
  - 支持单向和双向 IPC 通信
  - 返回清理函数用于移除事件监听器
- **types/electron.d.ts**：新增 TypeScript 类型定义
  - `UpdateInfo` 接口：定义更新信息结构
  - `ProgressInfo` 接口：定义下载进度数据结构
  - 扩展 `ElectronAPI` 接口包含 updater 方法
- **app/layout.tsx**：在根布局中引入 UpdateNotification 组件
  - 全局可用的更新通知
  - 仅在 Electron 环境中激活

### 技术细节
- 使用 `electron-updater` 库实现自动更新（基于 Squirrel）
- 更新源配置为 GitHub Release (provider: github)
- `autoDownload` 设为 false，由用户手动触发下载
- `autoInstallOnAppQuit` 设为 true，退出时自动安装
- 开发环境禁用自动更新功能，避免干扰开发
- 更新文件（latest-mac.yml）由 electron-builder 自动生成
- 支持增量更新，仅下载变更部分（通过 blockmap）
- 完整的错误处理和日志记录

### 安全性
- electron-updater 自动验证下载文件的签名和 SHA-512 哈希
- 仅通过 HTTPS 从 GitHub 下载更新文件
- 签名验证确保更新文件未被篡改

---

## [1.1.1] - 2025-10-07

### 新增
- **鼠标拖动航图功能**：在非自动适配模式下，可以使用鼠标拖动移动 PDF
  - 点击并拖动即可移动航图查看不同区域
  - 自动限制在 PDF 边界内，不会超出范围
  - 拖动时显示"抓手"光标，提供视觉反馈
  - 拖动时自动防止文本被意外选中
  - 不会干扰按钮和链接的正常点击

### 变更
- **统一 PDF 渲染架构**：Auto 模式和手动缩放模式现在使用相同的双层缩放架构
  - Auto 模式也使用高清 renderScale 渲染，然后通过 CSS transform 缩放到适配尺寸
  - 大幅提升 Auto 模式下的 PDF 清晰度（提升 100-300%）
  - 代码逻辑更统一，便于维护和未来优化
- **智能渲染质量优化**：Auto 模式下动态计算最佳渲染倍率
  - 根据窗口大小自动计算 autoFitScale
  - renderScale 动态调整为 fitScale 的 1.5 倍，范围 2.0x-4.0x
  - 确保放大查看时始终保持高清晰度
- **动态 DPI 检测**：devicePixelRatio 从固定值改为动态检测
  - 自动适配 Retina 等高 DPI 屏幕
  - 使用 `Math.max(window.devicePixelRatio || 1, 2)` 确保至少 2 倍渲染
  - 在高分辨率屏幕上显示更加清晰
- **响应式窗口调整**：容器尺寸变化时自动重新计算渲染参数
  - 调整窗口大小时自动更新 autoFitScale 和 renderScale
  - 保持最佳显示效果和清晰度

### 修复
- **Auto 模式居中显示**：修复 Auto 模式下 PDF 不在正中央的问题
  - 外层容器改为 auto 尺寸，配合 flex 布局居中
  - 内层容器缩放原点从 `top left` 改为 `center center`
  - PDF 现在完美居中显示

### 技术细节
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
- **鼠标滚轮缩放功能**：按住 Ctrl（Windows/Linux）或 Cmd（Mac）+ 滚轮即可缩放 PDF
  - 支持 0.5x 到 3.0x 的缩放范围
  - 智能延迟重渲染机制，缩放时使用 CSS transform 保持流畅
  - 停止缩放 500ms 后自动以最佳质量重新渲染
  - 工具栏提示显示快捷键操作方式

### 变更
- **优化 PDF 渲染策略**：引入动态渲染比例系统
  - 基础渲染比例从固定值改为动态计算（1.5x 到 3.0x）
  - 根据当前缩放级别智能调整渲染质量
  - 缩放时使用 CSS transform 实现即时响应
  - 减少不必要的重渲染，提升性能和流畅度
- **改进用户体验**：打开机场下拉菜单时自动关闭已打开的图表分类列表
  - 避免界面元素重叠
  - 提供更清晰的导航流程

### 技术细节
- PDF 缩放使用双层结构：外层容器控制滚动区域，内层应用 CSS transform
- 智能重渲染使用防抖机制，避免频繁重新渲染
- 渲染比例动态优化：放大时提高渲染质量，缩小时降低以节省内存
- 页面切换时重置页面尺寸以确保正确布局
- 所有缩放操作（按钮、滚轮、快捷键）共享统一的缩放逻辑

---

## [1.0.8] - 2025-10-05

### 新增
- **完整的主题切换系统**：为整个应用添加亮色和暗色主题切换功能
  - 主题切换按钮集成在 Sidebar 底部
  - 支持亮色模式、暗色模式和跟随系统
  - 所有组件完美适配两种主题
- **PDF 颜色反转（黑暗模式）**：PDF 内容自动跟随主题进行颜色反转
  - 暗色主题下 PDF 自动反转颜色，减少眼睛疲劳
  - 亮色主题下 PDF 保持原始外观
  - 无需额外按钮，自动同步

### 变更
- **统一 UI 风格**：ChartList 采用与 Sidebar 一致的深色主题设计
  - 背景：亮色模式使用浅灰色，暗色模式使用深灰色
  - 按钮和卡片样式统一
  - 改善视觉一致性和层次感
- **优化主题默认设置**：默认主题从固定暗色改为跟随系统（`system`）
- **提升 PDF 渲染质量**：大幅提高自动适配模式下的 PDF 清晰度
  - 像素密度提升至至少 3x
  - 添加字体平滑和 GPU 加速
  - 文字和线条更加锐利清晰

### 修复
- 修复主题切换按钮样式未适配主题的问题
- 修复 PDF 边框过强的阴影效果（改为更柔和的阴影）

### 技术细节
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
- **修复 Electron 打包后空白页面问题**：应用在打包后无法正常显示的关键问题
- **修复配置文件无法保存问题**：配置现在保存到用户数据目录而非只读的应用包内
- 修复生产环境 Next.js 服务器启动失败（ENOTDIR 错误）

### 变更
- **重构 Electron 生产环境架构**：在打包应用中内嵌 Next.js 服务器而非使用静态文件
- 更新打包配置：打包 `.next/` 目录而非不存在的 `out/` 目录
- 生产环境使用 Next.js Node.js API 启动服务器，支持所有 API Routes
- 配置文件路径改为使用 Electron userData 目录（macOS: `~/Library/Application Support/Chart Viewer/config.json`）
- 添加动态端口分配以避免端口冲突
- 优化 Next.js 配置，启用压缩和性能优化

### 技术细节
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
- 跨平台安装包支持 (macOS, Windows, Linux)
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

## 版本说明

### 版本号规则
- **MAJOR.MINOR.PATCH** (例如 1.2.3)
  - MAJOR: 重大更改，可能不向后兼容
  - MINOR: 新功能，向后兼容
  - PATCH: Bug 修复，向后兼容

### 预发布版本
- **alpha**: 早期测试版本，功能不完整
- **beta**: 功能完整，但可能有 bug
- **rc**: 候选发布版本，准备正式发布

### 更新日志分类
- **新增**: 新功能
- **变更**: 现有功能的更改
- **弃用**: 即将删除的功能
- **删除**: 已删除的功能
- **修复**: Bug 修复
- **安全**: 安全相关的更改

[Unreleased]: https://github.com/6639835/chart-viewer/compare/v1.1.3...HEAD
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
