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

[Unreleased]: https://github.com/6639835/chart-viewer/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/6639835/chart-viewer/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/6639835/chart-viewer/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/6639835/chart-viewer/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/6639835/chart-viewer/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/6639835/chart-viewer/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/6639835/chart-viewer/releases/tag/v1.0.0
