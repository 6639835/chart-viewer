import {
  ChartData,
  GroupedCharts,
  CHART_TYPE_MAPPING,
  ChartCategory,
  PerAirportChartData,
  AirportInfo,
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

export function parsePerAirportCSV(
  csvContent: string,
  airportIcao: string
): ChartData[] {
  const result = Papa.parse<PerAirportChartData>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  // Convert per-airport format to standard ChartData format
  return result.data
    .filter((row: PerAirportChartData) => {
      // 机场细则 doesn't have PAGE_NUMBER, but has ChartName
      if (row.ChartTypeEx_CH === "机场细则") {
        return !!row.ChartName;
      }
      return !!row.PAGE_NUMBER;
    })
    .map((row: PerAirportChartData) => {
      // Generate a unique ChartId based on airport ICAO and PAGE_NUMBER
      // For 机场细则 without PAGE_NUMBER, use ChartName
      const uniqueId = row.PAGE_NUMBER
        ? `${airportIcao}-${row.PAGE_NUMBER}`
        : `${airportIcao}-${row.ChartName}`;

      return {
        ChartId: uniqueId,
        AirportIcao: airportIcao,
        AirportIata: "",
        CityName: "",
        AirportName: "",
        ValidFrom: "",
        ValidUntil: "",
        FilePath: "",
        ChartName: row.ChartName,
        FileSize: "",
        ChartTypeEx_CH: row.ChartTypeEx_CH,
        MD5: "",
        AD_HP_ID: "",
        PAGE_NUMBER: row.PAGE_NUMBER,
        IS_SUP: row.IS_SUP === "True" ? "Y" : "N",
        SUP_REF_CHARTID: "",
        IS_MODIFIED: row.IsModify === "True" ? "Y" : "N",
      };
    });
}

export function parseAirportsCSV(csvContent: string): AirportInfo[] {
  const result = Papa.parse<AirportInfo>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  return result.data.filter((row: AirportInfo) => !!row.CODE_ID);
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
