"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import Sidebar from "@/components/Sidebar";
import ChartList from "@/components/ChartList";
import SettingsModal from "@/components/SettingsModal";
import { getPDFFileName } from "@/lib/chartParser";
import { getPdfUrl, loadGroupedCharts, openExternal } from "@/lib/tauriClient";
import {
  CATEGORY_ORDER,
  type ChartCategory,
  type ChartData,
  type GroupedCharts,
} from "@/types/chart";
import { Loader2 } from "lucide-react";

// Dynamic import PDFViewer with SSR disabled (PDF.js requires browser APIs)
const PDFViewer = nextDynamic(() => import("@/components/PDFViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
      <div className="text-gray-400">Loading PDF viewer...</div>
    </div>
  ),
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
  const [groupedCharts, setGroupedCharts] = useState<GroupedCharts>({});
  const [airports, setAirports] = useState<string[]>([]);
  const [selectedAirport, setSelectedAirport] = useState<string>("");
  const [selectedCategory, setSelectedCategory] =
    useState<ChartCategory | null>(null);
  const [selectedChart, setSelectedChart] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
    try {
      const data = await loadGroupedCharts();
      setGroupedCharts(data);
      const airportList = Object.keys(data).sort();
      setAirports(airportList);

      if (airportList.length > 0) {
        const firstAirport = airportList[0];
        setSelectedAirportWithDiagram(firstAirport, data[firstAirport]);
      }
    } catch (error) {
      console.error("Error loading charts:", error);
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
    // Reload charts after settings are saved
    setSelectedChart(null);
    setSelectedCategory(null);
    loadCharts();
  };

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
            Loading Chart Data...
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
            />
          ) : (
            <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500">
              <div className="text-center px-4">
                <p className="text-lg">No chart selected</p>
                <p className="text-sm mt-2">
                  <span className="lg:hidden">
                    Tap the menu to select a category and chart
                  </span>
                  <span className="hidden lg:inline">
                    Select a category and chart to view
                  </span>
                </p>
                {/* Mobile menu button */}
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="lg:hidden mt-4 px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
                >
                  Open Menu
                </button>

                {/* Copyright Footer */}
                <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-600">
                  <p>Chart Viewer - EFB © 2025 Justin</p>
                  <button
                    onClick={() => {
                      const url = "https://github.com/6639835/chart-viewer";
                      openExternal(url).catch((error) =>
                        console.error("Error opening external URL:", error)
                      );
                    }}
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 inline-block mt-1 cursor-pointer"
                  >
                    GitHub Repository
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSaved}
      />
    </div>
  );
}
