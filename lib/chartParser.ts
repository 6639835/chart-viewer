import {
  ChartData,
  GroupedCharts,
  CHART_TYPE_MAPPING,
  ChartCategory,
} from "@/types/chart";
import Papa from "papaparse";

export function parseCSV(csvContent: string): ChartData[] {
  const result = Papa.parse<ChartData>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  // Filter out invalid rows, but allow empty PAGE_NUMBER for 机场细则
  return result.data.filter((row: ChartData) => {
    if (!row.AirportIcao) return false;
    // 机场细则 doesn't have PAGE_NUMBER, but has ChartName
    if (row.ChartTypeEx_CH === "机场细则") {
      return !!row.ChartName;
    }
    return !!row.PAGE_NUMBER;
  });
}

export function groupChartsByAirport(charts: ChartData[]): GroupedCharts {
  const grouped: GroupedCharts = {};
  const unmappedTypes = new Set<string>();

  charts.forEach((chart) => {
    const airport = chart.AirportIcao;
    let category = CHART_TYPE_MAPPING[chart.ChartTypeEx_CH] as ChartCategory;

    // Override category for specific chart names
    // Move "航路点坐标" and "数据库编码" to OTHER category
    if (chart.ChartName === "航路点坐标" || chart.ChartName === "数据库编码") {
      category = "OTHER";
    }

    if (!category) {
      unmappedTypes.add(chart.ChartTypeEx_CH);
      return;
    }

    if (!grouped[airport]) {
      grouped[airport] = {};
    }

    if (!grouped[airport][category]) {
      grouped[airport][category] = [];
    }

    grouped[airport][category]!.push(chart);
  });

  // Log unmapped types for debugging
  if (unmappedTypes.size > 0) {
    console.warn("Unmapped chart types:", Array.from(unmappedTypes));
  }

  return grouped;
}

export function getAirportList(groupedCharts: GroupedCharts): string[] {
  return Object.keys(groupedCharts).sort();
}

export function getPDFFileName(chart: ChartData): string {
  // For 机场细则, use ChartName.pdf (not AirportName as it contains slashes)
  if (chart.ChartTypeEx_CH === "机场细则") {
    return `${chart.ChartName}.pdf`;
  }

  // For other types, use AirportIcao-PAGE_NUMBER.pdf
  // Replace slashes with empty string to match actual file names
  const pageNumber = chart.PAGE_NUMBER.replace(/\//g, "");

  // Add (SUP) suffix if IS_SUP is 'Y'
  const supSuffix = chart.IS_SUP === "Y" ? "(SUP)" : "";

  return `${chart.AirportIcao}-${pageNumber}${supSuffix}.pdf`;
}
