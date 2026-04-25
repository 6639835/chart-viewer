import {
  ChartData,
  GroupedCharts,
  PerAirportChartData,
  AirportInfo,
  getChartCategory,
} from "@/types/chart";
import Papa from "papaparse";

const AIRPORT_DETAIL_TYPE = "机场细则";
const SUPPLEMENT_FLAG = "Y";

const FORCE_OTHER_CHART_NAMES = new Set(["航路点坐标", "数据库编码"]);

function parseRows<T>(csvContent: string): T[] {
  return Papa.parse<T>(csvContent, {
    header: true,
    skipEmptyLines: true,
  }).data;
}

function hasChartFileReference(row: {
  ChartName: string;
  ChartTypeEx_CH: string;
  PAGE_NUMBER: string;
}): boolean {
  if (row.ChartTypeEx_CH === AIRPORT_DETAIL_TYPE) {
    return row.ChartName.trim().length > 0;
  }

  return row.PAGE_NUMBER.trim().length > 0;
}

function toYesNo(value: string): "Y" | "N" {
  const normalized = value.trim().toUpperCase();
  return normalized === "TRUE" || normalized === "Y" ? "Y" : "N";
}

export function parseCSV(csvContent: string): ChartData[] {
  return parseRows<ChartData>(csvContent).filter(
    (row) => row.AirportIcao.trim().length > 0 && hasChartFileReference(row)
  );
}

export function parsePerAirportCSV(
  csvContent: string,
  airportIcao: string
): ChartData[] {
  const normalizedAirportIcao = airportIcao.trim().toUpperCase();
  if (!normalizedAirportIcao) {
    return [];
  }

  return parseRows<PerAirportChartData>(csvContent)
    .filter(hasChartFileReference)
    .map((row) => {
      const chartName = row.ChartName.trim();
      const pageNumber = row.PAGE_NUMBER.trim();
      const chartKey = pageNumber || chartName;

      return {
        ChartId: `${normalizedAirportIcao}-${chartKey}`,
        AirportIcao: normalizedAirportIcao,
        AirportIata: "",
        CityName: "",
        AirportName: "",
        ValidFrom: "",
        ValidUntil: "",
        FilePath: "",
        ChartName: chartName,
        FileSize: "",
        ChartTypeEx_CH: row.ChartTypeEx_CH.trim(),
        MD5: "",
        AD_HP_ID: "",
        PAGE_NUMBER: pageNumber,
        IS_SUP: toYesNo(row.IS_SUP),
        SUP_REF_CHARTID: "",
        IS_MODIFIED: toYesNo(row.IsModify),
      };
    });
}

export function parseAirportsCSV(csvContent: string): AirportInfo[] {
  return parseRows<AirportInfo>(csvContent).filter(
    (row) => row.CODE_ID.trim().length > 0
  );
}

export function groupChartsByAirport(charts: ChartData[]): GroupedCharts {
  const grouped: GroupedCharts = {};
  const unmappedTypes = new Set<string>();

  charts.forEach((chart) => {
    const airport = chart.AirportIcao;
    let category = getChartCategory(chart.ChartTypeEx_CH);

    if (FORCE_OTHER_CHART_NAMES.has(chart.ChartName)) {
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

  if (unmappedTypes.size > 0) {
    console.warn("Unmapped chart types:", Array.from(unmappedTypes));
  }

  return grouped;
}

export function getAirportList(groupedCharts: GroupedCharts): string[] {
  return Object.keys(groupedCharts).sort();
}

export function getPDFFileName(chart: ChartData): string {
  if (chart.ChartTypeEx_CH === AIRPORT_DETAIL_TYPE) {
    const safeName = chart.ChartName.replace(/\//g, "_").trim();
    return `${safeName}.pdf`;
  }

  const pageNumber = chart.PAGE_NUMBER.trim().replace(/\//g, "");
  const supSuffix = chart.IS_SUP === SUPPLEMENT_FLAG ? "(SUP)" : "";

  return `${chart.AirportIcao}-${pageNumber}${supSuffix}.pdf`;
}
