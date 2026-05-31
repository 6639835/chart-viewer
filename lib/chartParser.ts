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

function fieldValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasChartFileReference(row: {
  ChartName?: string;
  ChartTypeEx_CH?: string;
  PAGE_NUMBER?: string;
}): boolean {
  if (fieldValue(row.ChartTypeEx_CH) === AIRPORT_DETAIL_TYPE) {
    return fieldValue(row.ChartName).length > 0;
  }

  return fieldValue(row.PAGE_NUMBER).length > 0;
}

function toYesNo(value: unknown): "Y" | "N" {
  const normalized = fieldValue(value).toUpperCase();
  return normalized === "TRUE" || normalized === "Y" ? "Y" : "N";
}

function normalizeAirportIcao(value: unknown): string {
  return fieldValue(value).toUpperCase();
}

function chartIdFor(
  airportIcao: string,
  chartKey: string,
  isSupplement: "Y" | "N",
  fallbackId?: string
): string {
  const normalizedFallbackId = fieldValue(fallbackId);
  if (normalizedFallbackId) {
    return isSupplement === SUPPLEMENT_FLAG &&
      !normalizedFallbackId.endsWith("-SUP")
      ? `${normalizedFallbackId}-SUP`
      : normalizedFallbackId;
  }

  return `${airportIcao}-${chartKey}${isSupplement === SUPPLEMENT_FLAG ? "-SUP" : ""}`;
}

function normalizeChartData(row: ChartData): ChartData {
  const airportIcao = normalizeAirportIcao(row.AirportIcao);
  const chartName = fieldValue(row.ChartName);
  const pageNumber = fieldValue(row.PAGE_NUMBER);
  const isSupplement = toYesNo(row.IS_SUP);

  return {
    ChartId: chartIdFor(
      airportIcao,
      pageNumber || chartName,
      isSupplement,
      row.ChartId
    ),
    AirportIcao: airportIcao,
    AirportIata: fieldValue(row.AirportIata),
    CityName: fieldValue(row.CityName),
    AirportName: fieldValue(row.AirportName),
    ValidFrom: fieldValue(row.ValidFrom),
    ValidUntil: fieldValue(row.ValidUntil),
    FilePath: fieldValue(row.FilePath),
    ChartName: chartName,
    FileSize: fieldValue(row.FileSize),
    ChartTypeEx_CH: fieldValue(row.ChartTypeEx_CH),
    MD5: fieldValue(row.MD5),
    AD_HP_ID: fieldValue(row.AD_HP_ID),
    PAGE_NUMBER: pageNumber,
    IS_SUP: isSupplement,
    SUP_REF_CHARTID: fieldValue(row.SUP_REF_CHARTID),
    IS_MODIFIED: toYesNo(row.IS_MODIFIED),
  };
}

export function parseCSV(csvContent: string): ChartData[] {
  return parseRows<ChartData>(csvContent)
    .filter(
      (row) =>
        fieldValue(row.AirportIcao).length > 0 && hasChartFileReference(row)
    )
    .map(normalizeChartData);
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
      const chartName = fieldValue(row.ChartName);
      const pageNumber = fieldValue(row.PAGE_NUMBER);
      const chartKey = pageNumber || chartName;
      const isSupplement = toYesNo(row.IS_SUP);

      return {
        ChartId: chartIdFor(normalizedAirportIcao, chartKey, isSupplement),
        AirportIcao: normalizedAirportIcao,
        AirportIata: "",
        CityName: "",
        AirportName: "",
        ValidFrom: "",
        ValidUntil: "",
        FilePath: "",
        ChartName: chartName,
        FileSize: "",
        ChartTypeEx_CH: fieldValue(row.ChartTypeEx_CH),
        MD5: "",
        AD_HP_ID: "",
        PAGE_NUMBER: pageNumber,
        IS_SUP: isSupplement,
        SUP_REF_CHARTID: "",
        IS_MODIFIED: toYesNo(row.IsModify),
      };
    });
}

export function parseAirportsCSV(csvContent: string): AirportInfo[] {
  return parseRows<AirportInfo>(csvContent).filter(
    (row) => fieldValue(row.CODE_ID).length > 0
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
  const airportIcao = normalizeAirportIcao(chart.AirportIcao);

  if (chart.ChartTypeEx_CH === AIRPORT_DETAIL_TYPE) {
    const safeName = chart.ChartName.replace(/\//g, "_").trim();
    return airportIcao ? `${airportIcao}/${safeName}.pdf` : `${safeName}.pdf`;
  }

  const pageNumber = chart.PAGE_NUMBER.trim().replace(/\//g, "");
  const supSuffix = chart.IS_SUP === SUPPLEMENT_FLAG ? "(SUP)" : "";

  return `${airportIcao}-${pageNumber}${supSuffix}.pdf`;
}
