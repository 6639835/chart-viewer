"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import { useTheme } from "next-themes";
import Sidebar from "@/components/Sidebar";
import ChartList from "@/components/ChartList";
import SettingsModal from "@/components/SettingsModal";
import { useI18n } from "@/components/I18nProvider";
import { getPDFFileName } from "@/lib/chartParser";
import { getChartListDisplayCount } from "@/lib/chartListGrouping";
import {
  getPdfUrl,
  loadGroupedCharts,
  openExternal,
  georeferenceChart,
  getGeoreferenceCacheStatus,
  getGeoreferenceCacheSummary,
  getGeoreferencePreloadStatus,
  readAirportCoords,
  getConfig,
  preloadGeoreferenceCharts,
  type AirportCoord,
  type GeorefPreloadRequest,
} from "@/lib/tauriClient";
import type { GeorefResult, GeorefPageResult } from "@/types/georef";
import {
  CATEGORY_ORDER,
  type ChartCategory,
  type ChartData,
  type GroupedCharts,
  isGeoreferenceable,
} from "@/types/chart";
import {
  computeDisplayPageCorners,
  hasDisplayGcpOverlay,
} from "@/lib/georefMath";
import type { GeorefPdfBounds } from "@/lib/georefMath";
import type { ChartOverlayData } from "@/components/GlobeViewer";
import { useGdl90 } from "@/lib/useGdl90";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Loader2,
  MapPinned,
} from "lucide-react";

const MAP_OVERLAY_CACHE_LIMIT = 2;
const GEOREF_RESULT_CACHE_LIMIT = 8;
const MAP_OVERLAY_CACHE_VERSION = 7;
const GEOREF_INIT_PROMPT_SESSION_KEY = "chart-viewer-georef-init-prompted";

type MapOverlayTheme = "light" | "dark";

type GeorefPreloadUiStatus = {
  kind: "running" | "complete" | "error";
  ready: number;
  total: number;
  useMultiprocess: boolean;
  workerCount: number;
  startedJobs: number;
  activeJobs: number;
  processedJobs: number;
  totalJobs: number;
  failedJobs: number;
};

function getMapOverlayCacheKey(
  chartId: string,
  pdfFilePath: string,
  waypointFilePaths: string[],
  pageNumber: number,
  theme: MapOverlayTheme
) {
  return `${MAP_OVERLAY_CACHE_VERSION}:${theme}:${chartId}:${pageNumber}:${pdfFilePath}:${waypointFilePaths.join(",")}`;
}

function getGeorefCacheKey(
  chartId: string,
  pdfFilePath: string,
  waypointFilePaths: string[],
  pageNumber: number
) {
  return `${chartId}:${pageNumber}:${pdfFilePath}:${waypointFilePaths.join(",")}`;
}

function revokeOverlayImage(overlay: ChartOverlayData) {
  URL.revokeObjectURL(overlay.imageUrl);
}

function touchMapEntry<K, V>(cache: Map<K, V>, key: K) {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

function PDFViewerLoading() {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
      <div className="text-gray-400">{t("home.loadingPdfViewer")}</div>
    </div>
  );
}

function markGeorefInitPromptSeen() {
  window.sessionStorage.setItem(GEOREF_INIT_PROMPT_SESSION_KEY, "1");
}

function hasSeenGeorefInitPrompt() {
  return window.sessionStorage.getItem(GEOREF_INIT_PROMPT_SESSION_KEY) === "1";
}

function GeorefInitializationPrompt({
  isOpen,
  useMultiprocess,
  onUseMultiprocessChange,
  onStart,
  onSkip,
}: {
  isOpen: boolean;
  useMultiprocess: boolean;
  onUseMultiprocessChange: (value: boolean) => void;
  onStart: () => void;
  onSkip: () => void;
}) {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="georef-setup-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              <MapPinned className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="georef-setup-title"
                className="text-lg font-semibold text-gray-950 dark:text-white"
              >
                {t("georefSetup.title")}
              </h2>
              <p className="mt-1 text-sm leading-5 text-gray-600 dark:text-gray-300">
                {t("georefSetup.description")}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <label
            htmlFor="georef-setup-multiprocess"
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/70 dark:hover:bg-gray-800"
          >
            <input
              id="georef-setup-multiprocess"
              type="checkbox"
              checked={useMultiprocess}
              onChange={(event) =>
                onUseMultiprocessChange(event.target.checked)
              }
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                <Cpu className="h-4 w-4 text-gray-500 dark:text-gray-300" />
                {t("georefSetup.multiprocess")}
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                {t("georefSetup.multiprocessHelp")}
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-end dark:border-gray-700">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("georefSetup.cancel")}
          </button>
          <button
            type="button"
            onClick={onStart}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            {t("georefSetup.initialize")}
          </button>
        </div>
      </div>
    </div>
  );
}

function GeorefPreloadStatusBar({ status }: { status: GeorefPreloadUiStatus }) {
  const { t } = useI18n();
  const progressDone =
    status.kind === "running" && status.totalJobs > 0
      ? status.processedJobs
      : status.ready;
  const progressTotal =
    status.kind === "running" && status.totalJobs > 0
      ? status.totalJobs
      : status.total;
  const percent =
    progressTotal > 0
      ? Math.min(100, Math.round((progressDone / progressTotal) * 100))
      : 0;
  const isRunning = status.kind === "running";
  const isError = status.kind === "error";
  const message = isError
    ? t("georefSetup.error")
    : isRunning
      ? t("georefSetup.progress", {
          ready: status.ready,
          total: status.total,
          processed: status.processedJobs,
          jobTotal: status.totalJobs,
        })
      : status.ready >= status.total
        ? t("georefSetup.ready", {
            ready: status.ready,
            total: status.total,
          })
        : t("georefSetup.finished", {
            ready: status.ready,
            total: status.total,
          });
  const mode = status.useMultiprocess
    ? t("georefSetup.modeMultiprocess")
    : t("georefSetup.modeSingleProcess");
  const workerText =
    status.workerCount > 0
      ? t("georefSetup.workerStatus", {
          workers: status.workerCount,
          active: status.activeJobs,
          started: status.startedJobs,
          processed: status.processedJobs,
          total: status.totalJobs,
          failed: status.failedJobs,
        })
      : mode;

  return (
    <div
      role={isRunning ? "status" : isError ? "alert" : "status"}
      aria-live="polite"
      className="fixed bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
            isError
              ? "bg-red-100 text-red-700 dark:bg-red-900/35 dark:text-red-300"
              : isRunning
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/35 dark:text-blue-300"
                : "bg-green-100 text-green-700 dark:bg-green-900/35 dark:text-green-300"
          }`}
        >
          {isError ? (
            <AlertCircle className="h-4 w-4" />
          ) : isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {message}
            </p>
            {!isError && (
              <span className="flex-shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">
                {percent}%
              </span>
            )}
          </div>
          {!isError && (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isRunning ? "bg-blue-600" : "bg-green-600"
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {workerText}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Dynamic import PDFViewer with SSR disabled (PDF.js requires browser APIs)
const PDFViewer = nextDynamic(() => import("@/components/PDFViewer"), {
  ssr: false,
  loading: () => <PDFViewerLoading />,
});

const GlobeViewer = nextDynamic(() => import("@/components/GlobeViewer"), {
  ssr: false,
});

function findAirportDiagramChart(charts: ChartData[]): ChartData | null {
  // Try exact match of "机场图" first.
  const exact = charts.find((chart) => chart.ChartName === "机场图");
  if (exact) return exact;

  // Look for PAGE_NUMBER "2A" / "0G" (typical airport diagram).
  const byPage = charts.find(
    (chart) => chart.PAGE_NUMBER === "2A" || chart.PAGE_NUMBER === "0G"
  );
  if (byPage) return byPage;

  // Fallback: any chart that includes "机场图".
  const byName = charts.find((chart) => chart.ChartName.includes("机场图"));
  if (byName) return byName;

  // Final fallback: first TAXI chart.
  return charts[0] ?? null;
}

export default function Home() {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const [groupedCharts, setGroupedCharts] = useState<GroupedCharts>({});
  const [airportCoords, setAirportCoords] = useState<AirportCoord[]>([]);
  const [airports, setAirports] = useState<string[]>([]);
  const [selectedAirport, setSelectedAirport] = useState<string>("");
  const [selectedCategory, setSelectedCategory] =
    useState<ChartCategory | null>(null);
  const [selectedChart, setSelectedChart] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGlobeOpen, setIsGlobeOpen] = useState(false);
  const [gdl90Port, setGdl90Port] = useState<number>(4000);
  const ownshipPosition = useGdl90(gdl90Port > 0 ? gdl90Port : undefined);
  const [georefOverlay, setGeorefOverlay] = useState<ChartOverlayData | null>(
    null
  );
  const [currentGeorefPage, setCurrentGeorefPage] =
    useState<GeorefPageResult | null>(null);
  const [georefLoading, setGeorefLoading] = useState(false);
  const [georefError, setGeorefError] = useState<string | null>(null);
  const [georefReady, setGeorefReady] = useState(false);
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [preloadGeoreferences, setPreloadGeoreferences] = useState(true);
  const [isGeorefInitPromptOpen, setIsGeorefInitPromptOpen] = useState(false);
  const [georefInitUseMultiprocess, setGeorefInitUseMultiprocess] =
    useState(true);
  const [georefPreloadStatus, setGeorefPreloadStatus] =
    useState<GeorefPreloadUiStatus | null>(null);
  const getPageImageRef = useRef<
    | ((
        pageNumber: number,
        options?: {
          darkMode?: boolean;
          cropBounds?: GeorefPdfBounds;
        }
      ) => Promise<{ url: string; width: number; height: number } | null>)
    | null
  >(null);
  const mapOverlayCacheRef = useRef<Map<string, ChartOverlayData>>(new Map());
  const georefResultCacheRef = useRef<Map<string, Promise<GeorefResult>>>(
    new Map()
  );
  const georefRequestIdRef = useRef(0);
  const georefErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const georefPreloadPollTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const georefPreloadRunIdRef = useRef(0);
  const activeMapOverlayThemeRef = useRef<MapOverlayTheme>("light");
  const attemptedMapOverlayThemeRefreshRef = useRef<MapOverlayTheme | null>(
    null
  );
  const [bookmarkedCharts, setBookmarkedCharts] = useState<Set<string>>(
    new Set()
  );
  const [lastBookmarkedByCategory, setLastBookmarkedByCategory] = useState<
    Record<string, string>
  >({});
  const mapOverlayTheme: MapOverlayTheme =
    resolvedTheme === "dark" ? "dark" : "light";

  const setSelectedAirportWithDiagram = useCallback(
    (airport: string, chartsForAirport: GroupedCharts[string] | undefined) => {
      setSelectedAirport(airport);
      setSelectedCategory(null);

      const taxiCharts = chartsForAirport?.TAXI ?? [];
      const airportDiagram = findAirportDiagramChart(taxiCharts);

      if (!airportDiagram) {
        setSelectedChart(null);
        return;
      }

      setSelectedChart(airportDiagram);
      setBookmarkedCharts((prev) => {
        const next = new Set(prev);
        next.add(airportDiagram.ChartId);
        return next;
      });
      setLastBookmarkedByCategory((prev) => ({
        ...prev,
        [`${airport}_TAXI`]: airportDiagram.ChartId,
      }));
    },
    []
  );

  const loadCharts = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [data, coords, cfg] = await Promise.all([
        loadGroupedCharts(),
        readAirportCoords().catch(() => [] as AirportCoord[]),
        getConfig().catch(() => null),
      ]);
      setGroupedCharts(data);
      setAirportCoords(coords);
      if (cfg?.gdl90Port !== undefined) setGdl90Port(cfg.gdl90Port);
      setPreloadGeoreferences(cfg?.preloadGeoreferences ?? true);
      const airportList = Object.keys(data).sort();
      setAirports(airportList);

      if (airportList.length > 0) {
        const firstAirport = airportList[0];
        setSelectedAirportWithDiagram(firstAirport, data[firstAirport]);
      }
    } catch (error) {
      console.error("Error loading charts:", error);
      setGroupedCharts({});
      setAirportCoords([]);
      setAirports([]);
      setSelectedAirport("");
      setSelectedCategory(null);
      setSelectedChart(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [setSelectedAirportWithDiagram]);

  useEffect(() => {
    loadCharts();
  }, [loadCharts]);

  const handleAirportChange = (airport: string) => {
    setSelectedAirportWithDiagram(airport, groupedCharts[airport]);
  };

  const handleCategoryChange = (category: ChartCategory) => {
    // If the chart list is already open for this category, close it
    if (selectedCategory === category) {
      setSelectedCategory(null);
      return;
    }

    // Check if we're currently viewing a chart from this category
    const currentChartIsFromThisCategory =
      selectedChart &&
      groupedCharts[selectedAirport]?.[category]?.some(
        (c) => c.ChartId === selectedChart.ChartId
      );

    // If we're already viewing a chart from this category, open the list
    if (currentChartIsFromThisCategory) {
      setSelectedCategory(category);
      return;
    }

    // Otherwise, check if there are any bookmarked charts for this category
    const charts = groupedCharts[selectedAirport]?.[category] || [];
    const bookmarkedChartsInCategory = charts.filter((c) =>
      bookmarkedCharts.has(c.ChartId)
    );

    if (bookmarkedChartsInCategory.length > 0) {
      // Try to find the last bookmarked chart for this category first
      const categoryKey = `${selectedAirport}_${category}`;
      const lastBookmarkedId = lastBookmarkedByCategory[categoryKey];

      let chartToSelect = bookmarkedChartsInCategory[0]; // Default to first bookmarked chart

      // If we have a tracked "last bookmarked" chart, use that
      if (lastBookmarkedId) {
        const lastBookmarked = bookmarkedChartsInCategory.find(
          (c) => c.ChartId === lastBookmarkedId
        );
        if (lastBookmarked) {
          chartToSelect = lastBookmarked;
        }
      }

      // Auto-select the bookmarked chart and close the list
      setSelectedChart(chartToSelect);
      setSelectedCategory(null);
    } else {
      // No bookmarked charts, open the list over the current chart.
      setSelectedCategory(category);
    }
  };

  const handleCloseCategory = () => {
    setSelectedCategory(null);
  };

  const handleChartSelect = (chart: ChartData) => {
    setSelectedChart(chart);
    setCurrentPageNumber(1);
    setSelectedCategory(null); // Close the chart list after selection
  };

  const handleToggleBookmark = (chart: ChartData, category: ChartCategory) => {
    setBookmarkedCharts((prev) => {
      const next = new Set(prev);
      const categoryKey = `${selectedAirport}_${category}`;
      const isRemoving = next.has(chart.ChartId);

      if (isRemoving) {
        next.delete(chart.ChartId);
      } else {
        next.add(chart.ChartId);
      }

      setLastBookmarkedByCategory((prevLast) => {
        if (isRemoving) {
          if (prevLast[categoryKey] !== chart.ChartId) return prevLast;
          const nextLast = { ...prevLast };
          delete nextLast[categoryKey];
          return nextLast;
        }
        return { ...prevLast, [categoryKey]: chart.ChartId };
      });

      return next;
    });
  };

  const bookmarkedChartsForCurrentAirport = useMemo(() => {
    if (!selectedAirport) return [];
    const airportCharts = groupedCharts[selectedAirport];
    if (!airportCharts) return [];

    const allCharts: ChartData[] = [];
    for (const category of CATEGORY_ORDER) {
      allCharts.push(...(airportCharts[category] ?? []));
    }

    return allCharts.filter((chart) => bookmarkedCharts.has(chart.ChartId));
  }, [bookmarkedCharts, groupedCharts, selectedAirport]);

  const handleNavigateToBookmark = (direction: "next" | "prev") => {
    if (bookmarkedChartsForCurrentAirport.length === 0) return;

    const currentIndex = selectedChart
      ? bookmarkedChartsForCurrentAirport.findIndex(
          (c) => c.ChartId === selectedChart.ChartId
        )
      : -1;

    let nextIndex: number;
    if (direction === "next") {
      nextIndex =
        currentIndex < bookmarkedChartsForCurrentAirport.length - 1
          ? currentIndex + 1
          : 0;
    } else {
      nextIndex =
        currentIndex > 0
          ? currentIndex - 1
          : bookmarkedChartsForCurrentAirport.length - 1;
    }

    setSelectedChart(bookmarkedChartsForCurrentAirport[nextIndex]);
  };

  const handleSettingsSaved = () => {
    // Reload charts and config after settings are saved
    setSelectedChart(null);
    setSelectedCategory(null);
    for (const overlay of mapOverlayCacheRef.current.values()) {
      revokeOverlayImage(overlay);
    }
    mapOverlayCacheRef.current.clear();
    georefResultCacheRef.current.clear();
    void getConfig()
      .then((cfg) => {
        if (cfg?.gdl90Port !== undefined) setGdl90Port(cfg.gdl90Port);
        setPreloadGeoreferences(cfg?.preloadGeoreferences ?? true);
      })
      .catch(() => {});
    loadCharts();
  };

  const getWaypointFilePathsForAirport = useCallback(
    (airport: string) => {
      const airportCharts = groupedCharts[airport] ?? {};
      const allAirportCharts: ChartData[] = [];
      for (const charts of Object.values(airportCharts)) {
        if (charts) allAirportCharts.push(...charts);
      }
      return allAirportCharts
        .filter((chart) => chart.ChartName === "航路点坐标")
        .sort((a, b) => a.PAGE_NUMBER.localeCompare(b.PAGE_NUMBER))
        .map(getPDFFileName);
    },
    [groupedCharts]
  );

  const georefPreloadRequests = useMemo(() => {
    const requests: GeorefPreloadRequest[] = [];

    for (const airport of Object.keys(groupedCharts).sort()) {
      const waypointFilePaths = getWaypointFilePathsForAirport(airport);
      const airportCharts = groupedCharts[airport] ?? {};
      for (const category of CATEGORY_ORDER) {
        for (const chart of airportCharts[category] ?? []) {
          if (!isGeoreferenceable(chart)) continue;
          requests.push({
            chartId: chart.ChartId,
            filePath: getPDFFileName(chart),
            waypointFilePaths,
            pageNumber: 1,
          });
        }
      }
    }

    if (!selectedChart) return requests;

    return requests.sort((a, b) => {
      if (a.chartId === selectedChart.ChartId) return -1;
      if (b.chartId === selectedChart.ChartId) return 1;
      return 0;
    });
  }, [
    getWaypointFilePathsForAirport,
    groupedCharts,
    selectedChart,
  ]);

  const clearGeorefOverlay = useCallback(() => {
    setGeorefOverlay(null);
    setCurrentGeorefPage(null);
  }, []);

  const clearGeorefPreloadPolling = useCallback(() => {
    if (georefPreloadPollTimeoutRef.current) {
      clearTimeout(georefPreloadPollTimeoutRef.current);
      georefPreloadPollTimeoutRef.current = null;
    }
  }, []);

  const cacheMapOverlay = useCallback(
    (cacheKey: string, overlay: ChartOverlayData) => {
      const cache = mapOverlayCacheRef.current;
      const existingOverlay = cache.get(cacheKey);
      if (existingOverlay) {
        revokeOverlayImage(existingOverlay);
      }

      cache.delete(cacheKey);
      cache.set(cacheKey, overlay);

      while (cache.size > MAP_OVERLAY_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) break;
        const oldestOverlay = cache.get(oldestKey);
        cache.delete(oldestKey);
        if (oldestOverlay) {
          revokeOverlayImage(oldestOverlay);
        }
      }
    },
    []
  );

  const getCachedGeorefResult = useCallback(
    (
      cacheKey: string,
      chartId: string,
      pdfFilePath: string,
      waypointFilePaths: string[],
      pageNumber: number
    ) => {
      const cache = georefResultCacheRef.current;
      const cachedResult = touchMapEntry(cache, cacheKey);
      if (cachedResult) return cachedResult;

      const request = georeferenceChart(
        chartId,
        pdfFilePath,
        waypointFilePaths,
        pageNumber
      ).catch((error) => {
        cache.delete(cacheKey);
        throw error;
      });

      cache.set(cacheKey, request);

      while (cache.size > GEOREF_RESULT_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) break;
        cache.delete(oldestKey);
      }

      return request;
    },
    []
  );

  const showGeorefError = useCallback(
    (hasEnoughControls = false) => {
      if (georefErrorTimeoutRef.current) {
        clearTimeout(georefErrorTimeoutRef.current);
      }

      setGeorefError(
        t(hasEnoughControls ? "pdf.georefFitFailed" : "pdf.georefFailed")
      );
      georefErrorTimeoutRef.current = setTimeout(() => {
        setGeorefError(null);
        georefErrorTimeoutRef.current = null;
      }, 4000);
    },
    [t]
  );

  // Clear overlay when the user switches to a different chart
  useEffect(() => {
    georefRequestIdRef.current += 1;
    setGeorefLoading(false);
    setGeorefReady(false);
    setCurrentPageNumber(1);
    clearGeorefOverlay();
  }, [clearGeorefOverlay, selectedChart]);

  useEffect(() => {
    if (
      !preloadGeoreferences ||
      georefPreloadRequests.length === 0 ||
      georefPreloadStatus?.kind === "running"
    ) {
      return;
    }

    try {
      if (hasSeenGeorefInitPrompt()) return;
    } catch {
      // If session storage is unavailable, still allow the prompt.
    }

    let cancelled = false;
    getGeoreferenceCacheSummary(georefPreloadRequests)
      .then((summary) => {
        if (
          cancelled ||
          summary.total === 0 ||
          summary.ready >= summary.total
        ) {
          return;
        }
        setIsGeorefInitPromptOpen(true);
      })
      .catch((error) => {
        console.error("Error checking georeference cache summary:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [georefPreloadRequests, georefPreloadStatus?.kind, preloadGeoreferences]);

  useEffect(() => {
    let cancelled = false;

    const checkStatus = async () => {
      if (
        !selectedChart ||
        !selectedAirport ||
        !isGeoreferenceable(selectedChart)
      ) {
        setGeorefReady(false);
        return;
      }

      try {
        const status = await getGeoreferenceCacheStatus(
          getPDFFileName(selectedChart),
          getWaypointFilePathsForAirport(selectedAirport),
          currentPageNumber
        );
        if (!cancelled) {
          setGeorefReady(status.ready);
        }
      } catch {
        if (!cancelled) {
          setGeorefReady(false);
        }
      }
    };

    setGeorefReady(false);
    void checkStatus();
    const interval = setInterval(checkStatus, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    currentPageNumber,
    getWaypointFilePathsForAirport,
    selectedAirport,
    selectedChart,
  ]);

  useEffect(() => {
    const mapOverlayCache = mapOverlayCacheRef.current;
    const georefResultCache = georefResultCacheRef.current;

    return () => {
      clearGeorefOverlay();
      for (const overlay of mapOverlayCache.values()) {
        revokeOverlayImage(overlay);
      }
      mapOverlayCache.clear();
      georefResultCache.clear();
      if (georefErrorTimeoutRef.current) {
        clearTimeout(georefErrorTimeoutRef.current);
      }
      clearGeorefPreloadPolling();
    };
  }, [clearGeorefOverlay, clearGeorefPreloadPolling]);

  const handleShowOnMap = useCallback(
    async (pageNumber: number) => {
      if (!selectedChart) return;
      const requestId = georefRequestIdRef.current + 1;
      georefRequestIdRef.current = requestId;
      if (georefErrorTimeoutRef.current) {
        clearTimeout(georefErrorTimeoutRef.current);
        georefErrorTimeoutRef.current = null;
      }
      setGeorefLoading(true);
      setIsGlobeOpen(true);
      setGeorefError(null);
      try {
        const pdfFilePath = getPDFFileName(selectedChart);
        const waypointFilePaths =
          getWaypointFilePathsForAirport(selectedAirport);
        const mapOverlayCacheKey = getMapOverlayCacheKey(
          selectedChart.ChartId,
          pdfFilePath,
          waypointFilePaths,
          pageNumber,
          mapOverlayTheme
        );
        const georefCacheKey = getGeorefCacheKey(
          selectedChart.ChartId,
          pdfFilePath,
          waypointFilePaths,
          pageNumber
        );
        const result = await getCachedGeorefResult(
          georefCacheKey,
          selectedChart.ChartId,
          pdfFilePath,
          waypointFilePaths,
          pageNumber
        );
        const pageResult = result.pages.find((p) => p.page === pageNumber);
        if (requestId !== georefRequestIdRef.current) {
          return;
        }

        if (!pageResult || !hasDisplayGcpOverlay(pageResult)) {
          showGeorefError((pageResult?.controlPointCount ?? 0) >= 2);
          return;
        }

        const cachedOverlay = touchMapEntry(
          mapOverlayCacheRef.current,
          mapOverlayCacheKey
        );
        if (cachedOverlay) {
          activeMapOverlayThemeRef.current = mapOverlayTheme;
          attemptedMapOverlayThemeRefreshRef.current = null;
          setGeorefOverlay(cachedOverlay);
          setCurrentGeorefPage(pageResult);
          setGeorefLoading(false);
          return;
        }

        const pageBounds = {
          left: 0,
          top: 0,
          right: pageResult.pageWidth,
          bottom: pageResult.pageHeight,
        };
        const image = await getPageImageRef.current?.(pageNumber, {
          darkMode: mapOverlayTheme === "dark",
          cropBounds: pageBounds,
        });
        if (!image) {
          showGeorefError();
          return;
        }
        if (requestId !== georefRequestIdRef.current) {
          URL.revokeObjectURL(image.url);
          return;
        }

        const corners = computeDisplayPageCorners(pageResult, pageBounds);
        if (!corners) {
          showGeorefError((pageResult.controlPointCount ?? 0) >= 2);
          return;
        }
        const overlay: ChartOverlayData = {
          chartId: selectedChart.ChartId,
          pageNumber,
          imageUrl: image.url,
          imageWidth: image.width,
          imageHeight: image.height,
          corners,
        };
        cacheMapOverlay(mapOverlayCacheKey, overlay);
        activeMapOverlayThemeRef.current = mapOverlayTheme;
        attemptedMapOverlayThemeRefreshRef.current = null;
        setGeorefOverlay(overlay);
        setCurrentGeorefPage(pageResult);
      } catch (error) {
        if (requestId !== georefRequestIdRef.current) {
          return;
        }
        console.error("Georeferencing error:", error);
        showGeorefError();
      } finally {
        if (requestId === georefRequestIdRef.current) {
          setGeorefLoading(false);
        }
      }
    },
    [
      cacheMapOverlay,
      getCachedGeorefResult,
      mapOverlayTheme,
      selectedChart,
      selectedAirport,
      getWaypointFilePathsForAirport,
      showGeorefError,
    ]
  );

  useEffect(() => {
    if (!isGlobeOpen || !georefOverlay || georefLoading) return;
    if (activeMapOverlayThemeRef.current === mapOverlayTheme) {
      attemptedMapOverlayThemeRefreshRef.current = null;
      return;
    }
    if (attemptedMapOverlayThemeRefreshRef.current === mapOverlayTheme) return;

    attemptedMapOverlayThemeRefreshRef.current = mapOverlayTheme;
    void handleShowOnMap(georefOverlay.pageNumber);
  }, [
    georefLoading,
    georefOverlay,
    handleShowOnMap,
    isGlobeOpen,
    mapOverlayTheme,
  ]);

  const pollGeorefPreloadStatus = useCallback(
    (
      runId: number,
      requests: GeorefPreloadRequest[],
      useMultiprocess: boolean
    ) => {
      const poll = async () => {
        try {
          const [summary, preloadStatus] = await Promise.all([
            getGeoreferenceCacheSummary(requests),
            getGeoreferencePreloadStatus(),
          ]);
          if (runId !== georefPreloadRunIdRef.current) return;

          const isComplete =
            !preloadStatus.running || summary.ready >= summary.total;
          setGeorefPreloadStatus({
            kind: isComplete ? "complete" : "running",
            ready: summary.ready,
            total: summary.total,
            useMultiprocess: preloadStatus.useMultiprocess,
            workerCount: preloadStatus.workerCount,
            startedJobs: preloadStatus.startedJobs,
            activeJobs: preloadStatus.activeJobs,
            processedJobs: preloadStatus.processedJobs,
            totalJobs: preloadStatus.totalJobs,
            failedJobs: preloadStatus.failedJobs,
          });

          clearGeorefPreloadPolling();
          if (!isComplete) {
            georefPreloadPollTimeoutRef.current = setTimeout(poll, 1500);
            return;
          }

          georefPreloadPollTimeoutRef.current = setTimeout(() => {
            if (runId === georefPreloadRunIdRef.current) {
              setGeorefPreloadStatus(null);
            }
            georefPreloadPollTimeoutRef.current = null;
          }, 8000);
        } catch (error) {
          if (runId !== georefPreloadRunIdRef.current) return;
          console.error("Error polling georeference preload status:", error);
          clearGeorefPreloadPolling();
          setGeorefPreloadStatus({
            kind: "error",
            ready: 0,
            total: requests.length,
            useMultiprocess,
            workerCount: 0,
            startedJobs: 0,
            activeJobs: 0,
            processedJobs: 0,
            totalJobs: requests.length,
            failedJobs: 0,
          });
        }
      };

      void poll();
    },
    [clearGeorefPreloadPolling]
  );

  const handleStartGeorefInitialization = useCallback(async () => {
    const requests = georefPreloadRequests;
    if (requests.length === 0) {
      setIsGeorefInitPromptOpen(false);
      return;
    }

    try {
      markGeorefInitPromptSeen();
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }

    const useMultiprocess = georefInitUseMultiprocess;
    const runId = georefPreloadRunIdRef.current + 1;
    georefPreloadRunIdRef.current = runId;
    clearGeorefPreloadPolling();
    setIsGeorefInitPromptOpen(false);
    setGeorefPreloadStatus({
      kind: "running",
      ready: 0,
      total: requests.length,
      useMultiprocess,
      workerCount: 0,
      startedJobs: 0,
      activeJobs: 0,
      processedJobs: 0,
      totalJobs: requests.length,
      failedJobs: 0,
    });

    try {
      await preloadGeoreferenceCharts(requests, { useMultiprocess });
      pollGeorefPreloadStatus(runId, requests, useMultiprocess);
    } catch (error) {
      if (runId !== georefPreloadRunIdRef.current) return;
      console.error("Error preloading georeferences:", error);
      setGeorefPreloadStatus({
        kind: "error",
        ready: 0,
        total: requests.length,
        useMultiprocess,
        workerCount: 0,
        startedJobs: 0,
        activeJobs: 0,
        processedJobs: 0,
        totalJobs: requests.length,
        failedJobs: 0,
      });
    }
  }, [
    clearGeorefPreloadPolling,
    georefInitUseMultiprocess,
    georefPreloadRequests,
    pollGeorefPreloadStatus,
  ]);

  const handleSkipGeorefInitialization = useCallback(() => {
    try {
      markGeorefInitPromptSeen();
    } catch {
      // Session storage can be unavailable in restricted browser contexts.
    }
    setIsGeorefInitPromptOpen(false);
  }, []);

  const currentCharts =
    selectedAirport && selectedCategory
      ? groupedCharts[selectedAirport]?.[selectedCategory] || []
      : [];

  const categoryCounts: Record<ChartCategory, number> = CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = getChartListDisplayCount(
        groupedCharts[selectedAirport]?.[category] ?? [],
        category
      );
      return acc;
    },
    {} as Record<ChartCategory, number>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-900 dark:text-white text-lg">
            {t("home.loadingChartData")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile/Tablet Sidebar Overlay */}
      <div className="lg:hidden">
        {isSidebarOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 z-30 transition-opacity"
              onClick={() => setIsSidebarOpen(false)}
            />
            {/* Sliding Sidebar */}
            <div className="fixed left-0 top-0 bottom-0 w-20 z-40 transform transition-transform">
              <Sidebar
                airports={airports}
                selectedAirport={selectedAirport}
                selectedCategory={selectedCategory}
                onAirportChange={handleAirportChange}
                onCategoryChange={handleCategoryChange}
                categoryCounts={categoryCounts}
                onClose={() => setIsSidebarOpen(false)}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenGlobe={() => setIsGlobeOpen(true)}
                onCloseCategory={handleCloseCategory}
              />
            </div>
          </>
        )}
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          airports={airports}
          selectedAirport={selectedAirport}
          selectedCategory={selectedCategory}
          onAirportChange={handleAirportChange}
          onCategoryChange={handleCategoryChange}
          categoryCounts={categoryCounts}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenGlobe={() => setIsGlobeOpen(true)}
          onCloseCategory={handleCloseCategory}
        />
      </div>

      <div className="flex-1 relative overflow-hidden">
        {/* Chart List Panel - Slides in from left when category selected */}
        {selectedCategory && (
          <>
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 z-10 transition-opacity"
              onClick={() => setSelectedCategory(null)}
            />

            {/* Sliding Panel - Responsive width */}
            <div className="absolute left-0 top-0 bottom-0 w-full sm:w-96 md:w-md lg:w-96 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-hidden z-20 shadow-2xl">
              <ChartList
                charts={currentCharts}
                selectedChart={selectedChart}
                onChartSelect={handleChartSelect}
                category={selectedCategory}
                bookmarkedCharts={bookmarkedCharts}
                onToggleBookmark={handleToggleBookmark}
              />
            </div>
          </>
        )}

        {/* PDF Viewer Panel - Full width */}
        <div className="w-full h-full overflow-hidden">
          {selectedChart ? (
            <PDFViewer
              pdfUrl={getPdfUrl(getPDFFileName(selectedChart))}
              chart={selectedChart}
              onOpenSidebar={() => setIsSidebarOpen(true)}
              bookmarkedCharts={bookmarkedChartsForCurrentAirport}
              onNavigateToBookmark={handleNavigateToBookmark}
              onPageChange={setCurrentPageNumber}
              onShowOnMap={handleShowOnMap}
              georefLoading={georefLoading}
              georefReady={georefReady}
              getPageImageRef={getPageImageRef}
              ownshipPosition={ownshipPosition}
              georefPage={currentGeorefPage}
            />
          ) : (
            <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500">
              <div className="text-center px-4">
                <p className="text-lg">
                  {loadError
                    ? t("home.failedToLoadChartData")
                    : t("home.noChartSelected")}
                </p>
                <p className="text-sm mt-2">
                  <span className="lg:hidden">{t("home.tapMenuToSelect")}</span>
                  <span className="hidden lg:inline">
                    {t("home.selectCategoryAndChart")}
                  </span>
                </p>
                {/* Mobile menu button */}
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="lg:hidden mt-4 px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
                >
                  {t("home.openMenu")}
                </button>

                {/* Copyright Footer */}
                <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-600">
                  <p>{t("app.title")} © 2025 Justin</p>
                  <button
                    onClick={() => {
                      const url = "https://github.com/6639835/chart-viewer";
                      openExternal(url).catch((error) =>
                        console.error("Error opening external URL:", error)
                      );
                    }}
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 inline-block mt-1 cursor-pointer"
                  >
                    {t("common.githubRepository")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Georef error toast */}
      {georefError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-600 text-white text-sm rounded-lg shadow-lg pointer-events-none">
          {georefError}
        </div>
      )}

      {/* 2D map viewer */}
      {isGlobeOpen && (
        <GlobeViewer
          onClose={() => {
            georefRequestIdRef.current += 1;
            setGeorefLoading(false);
            setIsGlobeOpen(false);
            clearGeorefOverlay();
          }}
          targetAirport={selectedAirport}
          chartOverlay={georefOverlay}
          chartOverlayLoading={georefLoading && !georefOverlay}
          airportCoords={airportCoords}
          ownshipPosition={ownshipPosition}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSaved}
      />

      <GeorefInitializationPrompt
        isOpen={isGeorefInitPromptOpen}
        useMultiprocess={georefInitUseMultiprocess}
        onUseMultiprocessChange={setGeorefInitUseMultiprocess}
        onStart={handleStartGeorefInitialization}
        onSkip={handleSkipGeorefInitialization}
      />

      {georefPreloadStatus && (
        <GeorefPreloadStatusBar status={georefPreloadStatus} />
      )}
    </div>
  );
}
