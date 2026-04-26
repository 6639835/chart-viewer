import type { ChartCategory } from "@/types/chart";

export const LOCALES = ["en-US", "zh-CN"] as const;

export type Locale = (typeof LOCALES)[number];

export type TranslationKey =
  | "app.description"
  | "app.title"
  | "common.cancel"
  | "common.close"
  | "common.githubRepository"
  | "common.language"
  | "common.loading"
  | "common.saveChanges"
  | "common.saved"
  | "common.saving"
  | "common.selectLanguage"
  | "settings.about"
  | "settings.browse"
  | "settings.chartsDirectory"
  | "settings.chartsDirectoryHelp"
  | "settings.closeSettings"
  | "settings.configSaved"
  | "settings.copyright"
  | "settings.csvDirectory"
  | "settings.csvDirectoryHelp"
  | "settings.errorLoadingConfig"
  | "settings.errorSelectingDirectory"
  | "settings.license"
  | "settings.pathFormat"
  | "settings.pathFormatAbsolute"
  | "settings.pathFormatRelative"
  | "settings.selectChartsDirectory"
  | "settings.selectCsvDirectory"
  | "settings.title"
  | "sidebar.closeSidebar"
  | "sidebar.noAirportsFound"
  | "sidebar.searchAirport"
  | "sidebar.settings"
  | "theme.switchToDark"
  | "theme.switchToLight"
  | "theme.toggle"
  | "home.loadingChartData"
  | "home.loadingPdfViewer"
  | "home.noChartSelected"
  | "home.openMenu"
  | "home.selectCategoryAndChart"
  | "home.tapMenuToSelect"
  | "chartList.addBookmark"
  | "chartList.all"
  | "chartList.chart"
  | "chartList.charts"
  | "chartList.chartsHeading"
  | "chartList.noChartsAvailable"
  | "chartList.otherCharts"
  | "chartList.removeBookmark"
  | "chartList.selectCategoryWithCharts"
  | "pdf.autoZoom"
  | "pdf.currentZoomLevel"
  | "pdf.failedToLoad"
  | "pdf.failedToRender"
  | "pdf.fitToWindow"
  | "pdf.loadingPdf"
  | "pdf.next"
  | "pdf.nextBookmark"
  | "pdf.openMenu"
  | "pdf.prev"
  | "pdf.previousBookmark"
  | "pdf.renderingPdf"
  | "pdf.zoomIn"
  | "pdf.zoomOut"
  | "update.available"
  | "update.checkFailed"
  | "update.checkOnGitHub"
  | "update.close"
  | "update.download"
  | "update.downloaded"
  | "update.downloading"
  | "update.restartInstall"
  | "update.versionAvailable"
  | "update.versionDownloaded"
  | "update.waitDownloading";

export type Translations = Record<TranslationKey, string>;

type ChartTypeTranslations = Record<string, string>;

export const DEFAULT_LOCALE: Locale = "en-US";

export const LOCALE_LABELS: Record<Locale, string> = {
  "en-US": "English (US)",
  "zh-CN": "简体中文",
};

export const translations: Record<Locale, Translations> = {
  "en-US": {
    "app.description": "Electronic Flight Bag Chart Viewer",
    "app.title": "Chart Viewer - EFB",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.githubRepository": "GitHub Repository",
    "common.language": "Language",
    "common.loading": "Loading...",
    "common.saveChanges": "Save Changes",
    "common.saved": "Saved",
    "common.saving": "Saving...",
    "common.selectLanguage": "Select language",
    "settings.about": "About",
    "settings.browse": "Browse",
    "settings.chartsDirectory": "Charts Directory",
    "settings.chartsDirectoryHelp":
      "Path to the directory containing PDF chart files",
    "settings.closeSettings": "Close settings",
    "settings.configSaved": "Configuration saved successfully!",
    "settings.copyright": "© 2025 Justin. All rights reserved.",
    "settings.csvDirectory": "CSV Directory",
    "settings.csvDirectoryHelp":
      "Path to the directory containing Charts.csv file",
    "settings.errorLoadingConfig": "Error loading configuration",
    "settings.errorSelectingDirectory": "Error selecting directory",
    "settings.license": "Licensed under MIT License",
    "settings.pathFormat": "Path Format:",
    "settings.pathFormatAbsolute":
      "Or use absolute paths selected with the native picker",
    "settings.pathFormatRelative": "Use relative paths such as {path}",
    "settings.selectChartsDirectory": "Select Charts Directory",
    "settings.selectCsvDirectory": "Select CSV Directory",
    "settings.title": "Settings",
    "sidebar.closeSidebar": "Close sidebar",
    "sidebar.noAirportsFound": "No airports found",
    "sidebar.searchAirport": "Search airport...",
    "sidebar.settings": "Settings",
    "theme.switchToDark": "Switch to Dark Mode",
    "theme.switchToLight": "Switch to Light Mode",
    "theme.toggle": "Toggle theme",
    "home.loadingChartData": "Loading Chart Data...",
    "home.loadingPdfViewer": "Loading PDF viewer...",
    "home.noChartSelected": "No chart selected",
    "home.openMenu": "Open Menu",
    "home.selectCategoryAndChart": "Select a category and chart to view",
    "home.tapMenuToSelect": "Tap the menu to select a category and chart",
    "chartList.addBookmark": "Add bookmark",
    "chartList.all": "All",
    "chartList.chart": "chart",
    "chartList.charts": "charts",
    "chartList.chartsHeading": "Charts ({count})",
    "chartList.noChartsAvailable": "No charts available",
    "chartList.otherCharts": "Other Charts",
    "chartList.removeBookmark": "Remove bookmark",
    "chartList.selectCategoryWithCharts": "Select a category with charts",
    "pdf.autoZoom": "Auto",
    "pdf.currentZoomLevel": "Current zoom level",
    "pdf.failedToLoad": "Failed to load PDF. File may not exist.",
    "pdf.failedToRender": "Failed to render PDF page.",
    "pdf.fitToWindow": "Fit to Window",
    "pdf.loadingPdf": "Loading PDF...",
    "pdf.next": "NEXT",
    "pdf.nextBookmark": "Next Bookmark",
    "pdf.openMenu": "Open menu",
    "pdf.prev": "PREV",
    "pdf.previousBookmark": "Previous Bookmark",
    "pdf.renderingPdf": "Rendering PDF...",
    "pdf.zoomIn": "Zoom In",
    "pdf.zoomOut": "Zoom Out",
    "update.available": "New Update Available",
    "update.checkFailed": "Update Check Failed",
    "update.checkOnGitHub": "Check on GitHub",
    "update.close": "Close",
    "update.download": "Download Update",
    "update.downloaded": "Update Ready to Install",
    "update.downloading": "Downloading Update...",
    "update.restartInstall": "Restart & Install",
    "update.versionAvailable": "Version {version} is available.",
    "update.versionDownloaded":
      "Version {version} has been downloaded. Restart to apply.",
    "update.waitDownloading": "Please wait while the update is downloaded...",
  },
  "zh-CN": {
    "app.description": "电子飞行包航图查看器",
    "app.title": "航图查看器 - EFB",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.githubRepository": "GitHub 仓库",
    "common.language": "语言",
    "common.loading": "加载中...",
    "common.saveChanges": "保存更改",
    "common.saved": "已保存",
    "common.saving": "保存中...",
    "common.selectLanguage": "选择语言",
    "settings.about": "关于",
    "settings.browse": "浏览",
    "settings.chartsDirectory": "航图目录",
    "settings.chartsDirectoryHelp": "包含 PDF 航图文件的目录路径",
    "settings.closeSettings": "关闭设置",
    "settings.configSaved": "配置保存成功！",
    "settings.copyright": "© 2025 Justin。保留所有权利。",
    "settings.csvDirectory": "CSV 目录",
    "settings.csvDirectoryHelp": "包含 Charts.csv 文件的目录路径",
    "settings.errorLoadingConfig": "加载配置失败",
    "settings.errorSelectingDirectory": "选择目录失败",
    "settings.license": "基于 MIT 许可证发布",
    "settings.pathFormat": "路径格式：",
    "settings.pathFormatAbsolute": "也可以使用原生选择器选择绝对路径",
    "settings.pathFormatRelative": "使用相对路径，例如 {path}",
    "settings.selectChartsDirectory": "选择航图目录",
    "settings.selectCsvDirectory": "选择 CSV 目录",
    "settings.title": "设置",
    "sidebar.closeSidebar": "关闭侧边栏",
    "sidebar.noAirportsFound": "未找到机场",
    "sidebar.searchAirport": "搜索机场...",
    "sidebar.settings": "设置",
    "theme.switchToDark": "切换到深色模式",
    "theme.switchToLight": "切换到浅色模式",
    "theme.toggle": "切换主题",
    "home.loadingChartData": "正在加载航图数据...",
    "home.loadingPdfViewer": "正在加载 PDF 查看器...",
    "home.noChartSelected": "未选择航图",
    "home.openMenu": "打开菜单",
    "home.selectCategoryAndChart": "选择类别和航图以查看",
    "home.tapMenuToSelect": "点击菜单选择类别和航图",
    "chartList.addBookmark": "添加书签",
    "chartList.all": "全部",
    "chartList.chart": "张航图",
    "chartList.charts": "张航图",
    "chartList.chartsHeading": "航图（{count}）",
    "chartList.noChartsAvailable": "无可用航图",
    "chartList.otherCharts": "其他图表",
    "chartList.removeBookmark": "移除书签",
    "chartList.selectCategoryWithCharts": "选择包含航图的类别",
    "pdf.autoZoom": "自动",
    "pdf.currentZoomLevel": "当前缩放级别",
    "pdf.failedToLoad": "PDF 加载失败，文件可能不存在。",
    "pdf.failedToRender": "PDF 页面渲染失败。",
    "pdf.fitToWindow": "适应窗口",
    "pdf.loadingPdf": "正在加载 PDF...",
    "pdf.next": "下一页",
    "pdf.nextBookmark": "下一个书签",
    "pdf.openMenu": "打开菜单",
    "pdf.prev": "上一页",
    "pdf.previousBookmark": "上一个书签",
    "pdf.renderingPdf": "正在渲染 PDF...",
    "pdf.zoomIn": "放大",
    "pdf.zoomOut": "缩小",
    "update.available": "发现新版本",
    "update.checkFailed": "检查更新失败",
    "update.checkOnGitHub": "在 GitHub 上查看",
    "update.close": "关闭",
    "update.download": "下载更新",
    "update.downloaded": "更新已准备安装",
    "update.downloading": "正在下载更新...",
    "update.restartInstall": "重启并安装",
    "update.versionAvailable": "版本 {version} 可用。",
    "update.versionDownloaded": "版本 {version} 已下载。重启后生效。",
    "update.waitDownloading": "请等待更新下载完成...",
  },
};

export const categoryLabels: Record<Locale, Record<ChartCategory, string>> = {
  "en-US": {
    STAR: "STAR",
    APP: "APP",
    TAXI: "TAXI",
    SID: "SID",
    OTHER: "OTHER",
    细则: "Details",
  },
  "zh-CN": {
    STAR: "进场",
    APP: "进近",
    TAXI: "滑行",
    SID: "离场",
    OTHER: "其他",
    细则: "细则",
  },
};

export const chartTypeLabels: Record<Locale, ChartTypeTranslations> = {
  "en-US": {
    机场细则: "Airport Details",
    其他: "Other",
    机场图_停机位置图: "Airport / Parking Chart",
    标准仪表进场图: "STAR",
    标准仪表离场图: "SID",
    仪表进近图_ILS: "ILS Approach",
    进近图_RNAV_RNP_RADAR_GPS_GNSS: "RNAV/RNP/Radar/GPS/GNSS Approach",
    机场障碍物图_精密进近地形图:
      "Airport Obstacle / Precision Approach Terrain",
    仪表进近图_VOR: "VOR Approach",
    仪表进近图_NDB: "NDB Approach",
    最低监视引导高度图_放油区图:
      "Minimum Vectoring Altitude / Fuel Dumping Area",
  },
  "zh-CN": {
    机场细则: "机场细则",
    其他: "其他",
    机场图_停机位置图: "机场图_停机位置图",
    标准仪表进场图: "标准仪表进场图",
    标准仪表离场图: "标准仪表离场图",
    仪表进近图_ILS: "仪表进近图_ILS",
    进近图_RNAV_RNP_RADAR_GPS_GNSS: "进近图_RNAV_RNP_RADAR_GPS_GNSS",
    机场障碍物图_精密进近地形图: "机场障碍物图_精密进近地形图",
    仪表进近图_VOR: "仪表进近图_VOR",
    仪表进近图_NDB: "仪表进近图_NDB",
    最低监视引导高度图_放油区图: "最低监视引导高度图_放油区图",
  },
};

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function getBrowserLocale(): Locale {
  if (typeof navigator === "undefined") {
    return DEFAULT_LOCALE;
  }

  const candidates = [navigator.language, ...navigator.languages];
  return candidates.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en-US";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values?: Record<string, string | number>
) {
  const template =
    translations[locale][key] ?? translations[DEFAULT_LOCALE][key];

  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name])
  );
}

export function translateCategory(locale: Locale, category: ChartCategory) {
  return categoryLabels[locale][category];
}

export function translateChartType(locale: Locale, chartType: string) {
  return chartTypeLabels[locale][chartType] ?? chartType;
}
