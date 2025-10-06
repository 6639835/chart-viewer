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

[Unreleased]: https://github.com/6639835/chart-viewer/compare/v1.0.9...HEAD
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
