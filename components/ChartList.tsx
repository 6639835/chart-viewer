"use client";

import { ChartData, ChartCategory } from "@/types/chart";
import { FileText, Circle, CheckCircle2 } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  formatAppChartName,
  formatSidStarChartName,
} from "@/lib/chartFormatter";

interface ChartListProps {
  charts: ChartData[];
  selectedChart: ChartData | null;
  onChartSelect: (chart: ChartData) => void;
  category?: ChartCategory | null;
  bookmarkedCharts: Set<string>;
  onToggleBookmark: (chart: ChartData, category: ChartCategory) => void;
}

// Extract runway information from chart name
function extractRunways(chartName: string): string[] {
  const runways: string[] = [];

  // Pattern 1: RWY followed by runway numbers (e.g., RWY0136L36R, RWY18L18R19)
  const rwyMatch = chartName.match(/RWY(\d{2}(?:[LRC])?(?:\d{2}(?:[LRC])?)*)/i);
  if (rwyMatch) {
    const rwyString = rwyMatch[1];
    // Split into individual runways (2-3 characters each)
    const matches = rwyString.match(/\d{2}[LRC]?/g);
    if (matches) {
      runways.push(...matches);
    }
  }

  return runways;
}

// Group charts by runway
function groupChartsByRunway(charts: ChartData[]): Map<string, ChartData[]> {
  const grouped = new Map<string, ChartData[]>();

  charts.forEach((chart) => {
    const runways = extractRunways(chart.ChartName);

    if (runways.length > 0) {
      // Add chart to each runway it serves
      runways.forEach((runway) => {
        if (!grouped.has(runway)) {
          grouped.set(runway, []);
        }
        grouped.get(runway)!.push(chart);
      });
    } else {
      // Charts without runway info go to "其他" group
      if (!grouped.has("其他")) {
        grouped.set("其他", []);
      }
      grouped.get("其他")!.push(chart);
    }
  });

  return grouped;
}

// Sort TAXI charts by PAGE_NUMBER (e.g., 2A, 2B, 2C, etc.)
function sortTaxiCharts(charts: ChartData[]): ChartData[] {
  return [...charts].sort((a, b) => {
    const pageA = a.PAGE_NUMBER;
    const pageB = b.PAGE_NUMBER;

    // Extract the numeric prefix and letter/suffix
    const parsePageNumber = (page: string) => {
      // Match patterns like: 2A, 2A-1, 2R01, 0G-1, 2C-1-SUP
      const match = page.match(/^(\d+)([A-Z]?)(-?\d*)(.*)?$/);
      if (!match) return { prefix: 0, letter: "", suffix: "", rest: page };

      return {
        prefix: parseInt(match[1]) || 0,
        letter: match[2] || "",
        suffix: match[3] || "",
        rest: match[4] || "",
      };
    };

    const parsedA = parsePageNumber(pageA);
    const parsedB = parsePageNumber(pageB);

    // Compare numeric prefix first
    if (parsedA.prefix !== parsedB.prefix) {
      return parsedA.prefix - parsedB.prefix;
    }

    // Then compare letter (A, B, C, etc.)
    if (parsedA.letter !== parsedB.letter) {
      return parsedA.letter.localeCompare(parsedB.letter);
    }

    // Then compare suffix
    if (parsedA.suffix !== parsedB.suffix) {
      return parsedA.suffix.localeCompare(parsedB.suffix);
    }

    // Finally compare the rest
    return parsedA.rest.localeCompare(parsedB.rest);
  });
}

export default function ChartList({
  charts,
  selectedChart,
  onChartSelect,
  category,
  bookmarkedCharts,
  onToggleBookmark,
}: ChartListProps) {
  // State for runway filter
  const [selectedRunwayFilter, setSelectedRunwayFilter] = useState<
    string | null
  >(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Reset filter when category changes
  useEffect(() => {
    setSelectedRunwayFilter(null);
  }, [category]);

  // Handle scroll event for auto-hide scrollbar
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      setIsScrolling(true);

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Hide scrollbar after 1 second of no scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 1000);
    };

    scrollContainer.addEventListener("scroll", handleScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // TAXI category should not be grouped by runway
  const shouldGroupByRunway = category !== "TAXI";

  // Helper function to get display name based on category
  const getDisplayName = (chart: ChartData): string => {
    if (category === "APP") {
      return formatAppChartName(chart.ChartName);
    }
    if (category === "SID" || category === "STAR") {
      return formatSidStarChartName(chart.ChartName);
    }
    return chart.ChartName;
  };

  // Sort TAXI charts by PAGE_NUMBER
  const sortedCharts = useMemo(() => {
    if (category === "TAXI") {
      return sortTaxiCharts(charts);
    }
    return charts;
  }, [charts, category]);

  const groupedCharts = useMemo(() => {
    if (!shouldGroupByRunway) {
      return null;
    }
    return groupChartsByRunway(sortedCharts);
  }, [sortedCharts, shouldGroupByRunway]);

  const sortedRunways = useMemo(() => {
    if (!groupedCharts) return [];
    const runways = Array.from(groupedCharts.keys());
    // Sort runways: numeric runways first, then "其他"
    return runways.sort((a, b) => {
      if (a === "其他") return 1;
      if (b === "其他") return -1;

      // Extract numeric part for comparison
      const aNum = parseInt(a.replace(/[LRC]/g, ""));
      const bNum = parseInt(b.replace(/[LRC]/g, ""));

      if (aNum !== bNum) return aNum - bNum;

      // If same number, sort by suffix (L < C < R)
      return a.localeCompare(b);
    });
  }, [groupedCharts]);

  // Filter runways based on selected filter
  const filteredRunways = useMemo(() => {
    if (!selectedRunwayFilter) return sortedRunways;
    return sortedRunways.filter((runway) => runway === selectedRunwayFilter);
  }, [sortedRunways, selectedRunwayFilter]);

  if (sortedCharts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No charts available</p>
          <p className="text-sm mt-2">Select a category with charts</p>
        </div>
      </div>
    );
  }

  // Render ungrouped list for TAXI
  if (!shouldGroupByRunway) {
    return (
      <div
        ref={scrollContainerRef}
        className={`h-full overflow-y-auto bg-white dark:bg-gray-900 auto-hide-scrollbar ${isScrolling ? "scrolling" : ""}`}
      >
        <div className="p-4 sm:p-6">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-4 pb-3 border-b-2 border-gray-200 dark:border-gray-800">
            Charts ({sortedCharts.length})
          </h2>
          <div className="space-y-2">
            {sortedCharts.map((chart) => {
              const isSup = chart.IS_SUP === "Y";
              const isModified = chart.IS_MODIFIED === "Y";
              const isBookmarked = bookmarkedCharts.has(chart.ChartId);
              return (
                <div key={chart.ChartId} className="relative">
                  <button
                    onClick={() => onChartSelect(chart)}
                    className={`w-full p-4 pr-12 rounded-lg transition-all text-left ${
                      selectedChart?.ChartId === chart.ChartId
                        ? "bg-blue-500 text-white shadow-lg"
                        : isSup
                          ? "bg-amber-50 dark:bg-amber-900/20 text-gray-900 dark:text-white hover:bg-amber-100 dark:hover:bg-amber-900/30 border-2 border-amber-400 dark:border-amber-600"
                          : isModified
                            ? "bg-blue-50 dark:bg-blue-900/20 text-gray-900 dark:text-white hover:bg-blue-100 dark:hover:bg-blue-900/30 border-2 border-blue-400 dark:border-blue-600"
                            : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <FileText
                        className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                          selectedChart?.ChartId === chart.ChartId
                            ? "text-white"
                            : isSup
                              ? "text-amber-600 dark:text-amber-400"
                              : isModified
                                ? "text-blue-600 dark:text-blue-400"
                                : "text-blue-500 dark:text-blue-400"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm sm:text-base mb-2 line-clamp-2 leading-snug break-words">
                          {getDisplayName(chart)}
                        </p>
                        <p
                          className={`text-xs sm:text-sm mb-1 truncate ${
                            selectedChart?.ChartId === chart.ChartId
                              ? "opacity-90"
                              : "text-gray-600 dark:text-gray-400"
                          }`}
                        >
                          {chart.PAGE_NUMBER}
                        </p>
                        {chart.ChartTypeEx_CH && (
                          <p
                            className={`text-xs truncate ${
                              selectedChart?.ChartId === chart.ChartId
                                ? "opacity-80"
                                : "text-gray-500 dark:text-gray-500"
                            }`}
                          >
                            {chart.ChartTypeEx_CH}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                  {/* Bookmark button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBookmark(chart, category!);
                    }}
                    className="absolute top-2 right-2 p-2 rounded-full hover:bg-white/20 dark:hover:bg-black/20 transition-colors z-10"
                    title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
                  >
                    {isBookmarked ? (
                      <CheckCircle2
                        className={`w-5 h-5 ${
                          selectedChart?.ChartId === chart.ChartId
                            ? "text-white"
                            : "text-green-600 dark:text-green-400"
                        }`}
                      />
                    ) : (
                      <Circle
                        className={`w-5 h-5 ${
                          selectedChart?.ChartId === chart.ChartId
                            ? "text-white opacity-70"
                            : "text-gray-400 dark:text-gray-500"
                        }`}
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Render grouped list for other categories
  return (
    <div
      ref={scrollContainerRef}
      className={`h-full overflow-y-auto bg-white dark:bg-gray-900 auto-hide-scrollbar ${isScrolling ? "scrolling" : ""}`}
    >
      <div className="p-4 sm:p-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-4 pb-3 border-b-2 border-gray-200 dark:border-gray-800">
          Charts ({sortedCharts.length})
        </h2>

        {/* Runway Filter */}
        {sortedRunways.length > 1 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedRunwayFilter(null)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  selectedRunwayFilter === null
                    ? "bg-blue-500 text-white shadow-md"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                全部
              </button>
              {sortedRunways.map((runway) => (
                <button
                  key={runway}
                  onClick={() => setSelectedRunwayFilter(runway)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    selectedRunwayFilter === runway
                      ? "bg-blue-500 text-white shadow-md"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {runway === "其他" ? "其他" : `RWY ${runway}`}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-5 sm:space-y-6">
          {filteredRunways.map((runway) => {
            const runwayCharts = groupedCharts!.get(runway)!;

            return (
              <div key={runway} className="space-y-3">
                {/* Runway Header */}
                <div className="flex items-center justify-between px-3 py-2 bg-gray-200 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-700">
                  <h3 className="font-bold text-sm sm:text-base text-gray-900 dark:text-white">
                    {runway === "其他" ? "其他图表" : `RWY ${runway}`}
                  </h3>
                  <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded font-medium flex-shrink-0 ml-2">
                    {runwayCharts.length} 张
                  </span>
                </div>

                {/* Charts List */}
                <div className="space-y-2">
                  {runwayCharts.map((chart) => {
                    const isSup = chart.IS_SUP === "Y";
                    const isModified = chart.IS_MODIFIED === "Y";
                    const isBookmarked = bookmarkedCharts.has(chart.ChartId);
                    return (
                      <div key={chart.ChartId} className="relative">
                        <button
                          onClick={() => onChartSelect(chart)}
                          className={`w-full p-4 pr-12 rounded-lg transition-all text-left ${
                            selectedChart?.ChartId === chart.ChartId
                              ? "bg-blue-500 text-white shadow-lg"
                              : isSup
                                ? "bg-amber-50 dark:bg-amber-900/20 text-gray-900 dark:text-white hover:bg-amber-100 dark:hover:bg-amber-900/30 border-2 border-amber-400 dark:border-amber-600"
                                : isModified
                                  ? "bg-blue-50 dark:bg-blue-900/20 text-gray-900 dark:text-white hover:bg-blue-100 dark:hover:bg-blue-900/30 border-2 border-blue-400 dark:border-blue-600"
                                  : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <FileText
                              className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                                selectedChart?.ChartId === chart.ChartId
                                  ? "text-white"
                                  : isSup
                                    ? "text-amber-600 dark:text-amber-400"
                                    : isModified
                                      ? "text-blue-600 dark:text-blue-400"
                                      : "text-blue-500 dark:text-blue-400"
                              }`}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm sm:text-base mb-2 line-clamp-2 leading-snug break-words">
                                {getDisplayName(chart)}
                              </p>
                              <p
                                className={`text-xs sm:text-sm mb-1 truncate ${
                                  selectedChart?.ChartId === chart.ChartId
                                    ? "opacity-90"
                                    : "text-gray-600 dark:text-gray-400"
                                }`}
                              >
                                {chart.PAGE_NUMBER}
                              </p>
                              {chart.ChartTypeEx_CH && (
                                <p
                                  className={`text-xs truncate ${
                                    selectedChart?.ChartId === chart.ChartId
                                      ? "opacity-80"
                                      : "text-gray-500 dark:text-gray-500"
                                  }`}
                                >
                                  {chart.ChartTypeEx_CH}
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                        {/* Bookmark button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleBookmark(chart, category!);
                          }}
                          className="absolute top-2 right-2 p-2 rounded-full hover:bg-white/20 dark:hover:bg-black/20 transition-colors z-10"
                          title={
                            isBookmarked ? "Remove bookmark" : "Add bookmark"
                          }
                        >
                          {isBookmarked ? (
                            <CheckCircle2
                              className={`w-5 h-5 ${
                                selectedChart?.ChartId === chart.ChartId
                                  ? "text-white"
                                  : "text-green-600 dark:text-green-400"
                              }`}
                            />
                          ) : (
                            <Circle
                              className={`w-5 h-5 ${
                                selectedChart?.ChartId === chart.ChartId
                                  ? "text-white opacity-70"
                                  : "text-gray-400 dark:text-gray-500"
                              }`}
                            />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
