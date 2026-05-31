"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import { useTheme } from "next-themes";
import Sidebar from "@/components/Sidebar";
import ChartList from "@/components/ChartList";
import SettingsModal from "@/components/SettingsModal";
import { useI18n } from "@/components/I18nProvider";
import { getPDFFileName } from "@/lib/chartParser";
import {
  getPdfUrl,
  loadGroupedCharts,
  openExternal,
  georeferenceChart,
  readAirportCoords,
  getConfig,
  type AirportCoord,
} from "@/lib/tauriClient";
import type { GeorefResult, GeorefPageResult } from "@/types/georef";
import {
  CATEGORY_ORDER,
  type ChartCategory,
  type ChartData,
  type GroupedCharts,
} from "@/types/chart";
import { computePageCorners } from "@/lib/georefMath";
import type { ChartOverlayData } from "@/components/GlobeViewer";
import { useGdl90 } from "@/lib/useGdl90";
import { Loader2 } from "lucide-react";

const MAP_OVERLAY_CACHE_LIMIT = 2;
const GEOREF_RESULT_CACHE_LIMIT = 8;

function getMapOverlayCacheKey(
  chartId: string,
  pdfFilePath: string,
  waypointFilePaths: string[],
  pageNumber: number,
  darkMode: boolean
) {
  return `${chartId}:${pageNumber}:${darkMode ? "dark" : "light"}:${pdfFilePath}:${waypointFilePaths.join(",")}`;
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
  if (overlay.imageUrl.startsWith("blob:")) {
    URL.revokeObjectURL(overlay.imageUrl);
  }
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
  const [currentGeorefPage, setCurrentGeorefPage] = useState<GeorefPageResult | null>(null);
  const [georefLoading, setGeorefLoading] = useState(false);
  const [georefError, setGeorefError] = useState<string | null>(null);
  const getPageImageRef = useRef<
    | ((
        pageNumber: number,
        options?: { darkMode?: boolean }
      ) => Promise<string | null>)
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
  const previousResolvedThemeRef = useRef<string | undefined>(undefined);
  const [bookmarkedCharts, setBookmarkedCharts] = useState<Set<string>>(
    new Set()
  );
  const [lastBookmarkedByCategory, setLastBookmarkedByCategory] = useState<
    Record<string, string>
  >({});

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
    void getConfig().then((cfg) => {
      if (cfg?.gdl90Port !== undefined) setGdl90Port(cfg.gdl90Port);
    }).catch(() => {});
    loadCharts();
  };

  const clearGeorefOverlay = useCallback(() => {
    setGeorefOverlay(null);
    setCurrentGeorefPage(null);
  }, []);

  const cacheMapOverlay = useCallback(
    (cacheKey: string, overlay: ChartOverlayData) => {
      const cache = mapOverlayCacheRef.current;
      const existingOverlay = cache.get(cacheKey);
      if (existingOverlay && existingOverlay.imageUrl !== overlay.imageUrl) {
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
    clearGeorefOverlay();
  }, [clearGeorefOverlay, selectedChart]);

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
    };
  }, [clearGeorefOverlay]);

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
      let imageUrl: string | null = null;
      let imagePromise: Promise<string | null> | null = null;
      let imagePromiseHandled = false;
      const releasePendingImage = () => {
        if (!imagePromise || imagePromiseHandled) return;
        imagePromiseHandled = true;
        void imagePromise
          .then((pendingImageUrl) => {
            if (pendingImageUrl?.startsWith("blob:")) {
              URL.revokeObjectURL(pendingImageUrl);
            }
          })
          .catch(() => {
            // The overlay render can be cancelled if the chart/map changes.
          });
      };
      try {
        const pdfFilePath = getPDFFileName(selectedChart);
        const pdfDarkMode = resolvedTheme === "dark";
        // Find all 航路点坐标 (waypoint coordinate table) PDFs for this airport.
        // Large airports often split the table across multiple 0W/4Y pages.
        const airportCharts = groupedCharts[selectedAirport] ?? {};
        const allAirportCharts: ChartData[] = [];
        for (const charts of Object.values(airportCharts)) {
          if (charts) allAirportCharts.push(...charts);
        }
        const waypointFilePaths = allAirportCharts
          .filter((c) => c.ChartName === "航路点坐标")
          .sort((a, b) => a.PAGE_NUMBER.localeCompare(b.PAGE_NUMBER))
          .map(getPDFFileName);
        const mapOverlayCacheKey = getMapOverlayCacheKey(
          selectedChart.ChartId,
          pdfFilePath,
          waypointFilePaths,
          pageNumber,
          pdfDarkMode
        );
        const georefCacheKey = getGeorefCacheKey(
          selectedChart.ChartId,
          pdfFilePath,
          waypointFilePaths,
          pageNumber
        );
        const cachedOverlay = touchMapEntry(
          mapOverlayCacheRef.current,
          mapOverlayCacheKey
        );
        if (cachedOverlay) {
          setGeorefOverlay(cachedOverlay);
          setGeorefLoading(false);
          return;
        }

        imagePromise =
          getPageImageRef.current?.(pageNumber, {
            darkMode: pdfDarkMode,
          }) ?? null;
        const result = await getCachedGeorefResult(
          georefCacheKey,
          selectedChart.ChartId,
          pdfFilePath,
          waypointFilePaths,
          pageNumber
        );
        const pageResult = result.pages.find((p) => p.page === pageNumber);
        if (requestId !== georefRequestIdRef.current) {
          releasePendingImage();
          return;
        }

        if (!pageResult?.georeferenced || !pageResult.transform) {
          releasePendingImage();
          showGeorefError((pageResult?.controlPointCount ?? 0) >= 3);
          return;
        }
        const corners = computePageCorners(
          pageResult.transform,
          pageResult.pageWidth,
          pageResult.pageHeight
        );

        imageUrl = imagePromise ? await imagePromise : null;
        imagePromiseHandled = true;
        if (requestId !== georefRequestIdRef.current) {
          if (imageUrl?.startsWith("blob:")) {
            URL.revokeObjectURL(imageUrl);
          }
          return;
        }

        if (!imageUrl) {
          showGeorefError();
          return;
        }

        const overlayImageUrl = imageUrl;
        imageUrl = null;
        const overlay: ChartOverlayData = {
          chartId: selectedChart.ChartId,
          pageNumber,
          corners,
          imageUrl: overlayImageUrl,
        };
        cacheMapOverlay(mapOverlayCacheKey, overlay);
        setGeorefOverlay(overlay);
        setCurrentGeorefPage(pageResult);
      } catch (error) {
        if (imageUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(imageUrl);
        }
        releasePendingImage();
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
      selectedChart,
      selectedAirport,
      groupedCharts,
      resolvedTheme,
      showGeorefError,
    ]
  );

  useEffect(() => {
    if (previousResolvedThemeRef.current === undefined) {
      previousResolvedThemeRef.current = resolvedTheme;
      return;
    }

    if (previousResolvedThemeRef.current === resolvedTheme) {
      return;
    }

    previousResolvedThemeRef.current = resolvedTheme;

    if (!isGlobeOpen || !georefOverlay) {
      return;
    }

    void handleShowOnMap(georefOverlay.pageNumber);
  }, [georefOverlay, handleShowOnMap, isGlobeOpen, resolvedTheme]);

  const currentCharts =
    selectedAirport && selectedCategory
      ? groupedCharts[selectedAirport]?.[selectedCategory] || []
      : [];

  const categoryCounts: Record<ChartCategory, number> = CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = groupedCharts[selectedAirport]?.[category]?.length || 0;
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
              onShowOnMap={handleShowOnMap}
              georefLoading={georefLoading}
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

      {/* 3D Globe Viewer */}
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
    </div>
  );
}
