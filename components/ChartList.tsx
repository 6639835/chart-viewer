"use client";

import { ChartData, ChartCategory } from "@/types/chart";
import { FileText, Circle, CheckCircle2 } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  formatAppChartName,
  formatSidStarChartName,
} from "@/lib/chartFormatter";
import { groupChartsByRunway, sortTaxiCharts } from "@/lib/chartListGrouping";
import { useAutoHideScrollbar } from "@/lib/hooks/useAutoHideScrollbar";
import { useI18n } from "@/components/I18nProvider";

interface ChartListProps {
  charts: ChartData[];
  selectedChart: ChartData | null;
  onChartSelect: (chart: ChartData) => void;
  category?: ChartCategory | null;
  bookmarkedCharts: Set<string>;
  onToggleBookmark: (chart: ChartData, category: ChartCategory) => void;
}

const LONG_CHART_NAME_LENGTH = 34;

export default function ChartList({
  charts,
  selectedChart,
  onChartSelect,
  category,
  bookmarkedCharts,
  onToggleBookmark,
}: ChartListProps) {
  const { t, tChartType } = useI18n();
  // State for runway filter
  const [selectedRunwayFilter, setSelectedRunwayFilter] = useState<
    string | null
  >(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isScrolling = useAutoHideScrollbar(scrollContainerRef);

  // Reset filter when category changes
  useEffect(() => {
    setSelectedRunwayFilter(null);
  }, [category]);

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

  const visibleChartCount = useMemo(() => {
    if (!shouldGroupByRunway || !groupedCharts) {
      return sortedCharts.length;
    }

    return filteredRunways.reduce(
      (count, runway) => count + (groupedCharts.get(runway)?.length ?? 0),
      0
    );
  }, [
    filteredRunways,
    groupedCharts,
    shouldGroupByRunway,
    sortedCharts.length,
  ]);

  if (sortedCharts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg">{t("chartList.noChartsAvailable")}</p>
          <p className="text-sm mt-2">
            {t("chartList.selectCategoryWithCharts")}
          </p>
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
            {t("chartList.chartsHeading", { count: visibleChartCount })}
          </h2>
          <div className="space-y-2">
            {sortedCharts.map((chart) => {
              const isSup = chart.IS_SUP === "Y";
              const isModified = chart.IS_MODIFIED === "Y";
              const isBookmarked = bookmarkedCharts.has(chart.ChartId);
              const displayName = getDisplayName(chart);
              const isLongName = displayName.length >= LONG_CHART_NAME_LENGTH;
              return (
                <div key={chart.ChartId} className="relative">
                  <button
                    onClick={() => onChartSelect(chart)}
                    title={displayName}
                    className={`w-full p-4 pr-12 rounded-lg transition-colors text-left ${
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
                        <p className="font-semibold text-sm sm:text-base mb-2 leading-snug break-words whitespace-normal text-pretty">
                          {displayName}
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
                        {!isLongName && chart.ChartTypeEx_CH && (
                          <p
                            className={`text-xs truncate ${
                              selectedChart?.ChartId === chart.ChartId
                                ? "opacity-80"
                                : "text-gray-500 dark:text-gray-500"
                            }`}
                          >
                            {tChartType(chart.ChartTypeEx_CH)}
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
                      isBookmarked
                        ? t("chartList.removeBookmark")
                        : t("chartList.addBookmark")
                    }
                    aria-label={
                      isBookmarked
                        ? t("chartList.removeBookmark")
                        : t("chartList.addBookmark")
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
          {t("chartList.chartsHeading", { count: visibleChartCount })}
        </h2>

        {/* Runway Filter */}
        {sortedRunways.length > 1 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedRunwayFilter(null)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedRunwayFilter === null
                    ? "bg-blue-500 text-white shadow-md"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {t("chartList.all")}
              </button>
              {sortedRunways.map((runway) => (
                <button
                  key={runway}
                  onClick={() => setSelectedRunwayFilter(runway)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedRunwayFilter === runway
                      ? "bg-blue-500 text-white shadow-md"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {runway === "其他"
                    ? t("chartList.otherCharts")
                    : `RWY ${runway}`}
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
                    {runway === "其他"
                      ? t("chartList.otherCharts")
                      : `RWY ${runway}`}
                  </h3>
                  <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 px-2 py-1 rounded font-medium flex-shrink-0 ml-2">
                    {runwayCharts.length}{" "}
                    {runwayCharts.length === 1
                      ? t("chartList.chart")
                      : t("chartList.charts")}
                  </span>
                </div>

                {/* Charts List */}
                <div className="space-y-2">
                  {runwayCharts.map((chart) => {
                    const isSup = chart.IS_SUP === "Y";
                    const isModified = chart.IS_MODIFIED === "Y";
                    const isBookmarked = bookmarkedCharts.has(chart.ChartId);
                    const displayName = getDisplayName(chart);
                    const isLongName =
                      displayName.length >= LONG_CHART_NAME_LENGTH;
                    return (
                      <div key={chart.ChartId} className="relative">
                        <button
                          onClick={() => onChartSelect(chart)}
                          title={displayName}
                          className={`w-full p-4 pr-12 rounded-lg transition-colors text-left ${
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
                              <p className="font-semibold text-sm sm:text-base mb-2 leading-snug break-words whitespace-normal text-pretty">
                                {displayName}
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
                              {!isLongName && chart.ChartTypeEx_CH && (
                                <p
                                  className={`text-xs truncate ${
                                    selectedChart?.ChartId === chart.ChartId
                                      ? "opacity-80"
                                      : "text-gray-500 dark:text-gray-500"
                                  }`}
                                >
                                  {tChartType(chart.ChartTypeEx_CH)}
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
                            isBookmarked
                              ? t("chartList.removeBookmark")
                              : t("chartList.addBookmark")
                          }
                          aria-label={
                            isBookmarked
                              ? t("chartList.removeBookmark")
                              : t("chartList.addBookmark")
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
