import type { ChartData } from "@/types/chart";
import { getChartCategory } from "@/types/chart";

const APPROACH_SUFFIXES = new Set(["W", "X", "Y", "Z"]);
const RUNWAY_SEQUENCE_PATTERN = /\d{2}[LRC]?/g;
const TRAILING_PARENTHESES_PATTERN = /(?:\([^)]*\))+$/;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isAlreadyFormatted(chartName: string): boolean {
  const withoutParentheses = chartName.replace(/\([^)]*\)/g, "");
  return withoutParentheses.includes(" ");
}

function formatRunwaySequence(runways: string): string {
  return runways.match(RUNWAY_SEQUENCE_PATTERN)?.join("/") ?? runways;
}

function formatWaypointGroup(waypoints: string): string {
  const waypointParts = waypoints.match(/.{1,5}/g);
  return waypointParts && waypointParts.length > 1
    ? waypointParts.join("/")
    : waypoints;
}

function parseCATRomanNumerals(roman: string): string {
  const normalized = roman.toUpperCase();

  if (normalized.endsWith("AI") || normalized.endsWith("A")) {
    return "I/II/IIIA";
  }

  switch (normalized.length) {
    case 1:
      return "I";
    case 2:
      return "II";
    case 3:
      return "III";
    case 4:
      return "I/II";
    case 6:
      return "II/III";
    default:
      return normalized;
  }
}

function extractTrailingParentheses(value: string): {
  base: string;
  qualifiers: string;
} {
  const match = value.match(TRAILING_PARENTHESES_PATTERN);
  if (!match) {
    return { base: value, qualifiers: "" };
  }

  return {
    base: value.slice(0, -match[0].length),
    qualifiers: normalizeWhitespace(match[0].replace(/\)\(/g, ") (")),
  };
}

function extractApproachSuffix(value: string): {
  base: string;
  suffix: string;
} {
  const suffix = value.at(-1)?.toUpperCase() ?? "";

  if (!APPROACH_SUFFIXES.has(suffix)) {
    return { base: value, suffix: "" };
  }

  return { base: value.slice(0, -1), suffix };
}

function removeRunwayReference(value: string): string {
  return value.replace(
    /\s*RWY?\s*\d{2}[LRC]?(?:\s*\/?\s*\d{2}[LRC]?)*(?=\s|\(|$)/gi,
    ""
  );
}

function normalizeCatLabels(value: string): string {
  return value
    .replace(/CAT-?([I]+A?I?)LSDME/gi, (_, roman) => {
      return `CAT-${parseCATRomanNumerals(roman)} ILS/DME`;
    })
    .replace(/CAT-?([I]+A?I?)\s+ILS\/DME/gi, (_, roman) => {
      return `CAT-${parseCATRomanNumerals(roman)} ILS/DME`;
    });
}

function normalizeApproachTokens(value: string): string {
  return normalizeCatLabels(value)
    .replace(/^(RNAV|RNP)(?=CAT-)/i, "$1 ")
    .replace(/^RNAV(?=ILS|LOC|VOR|NDB)/i, "RNAV ")
    .replace(/^RNP\(AR\)(?=ILS|LOC|VOR|NDB)/i, "RNP (AR) ")
    .replace(/^RNP(?=ILS|LOC|VOR|NDB)/i, "RNP ")
    .replace(/ILSDME/gi, "ILS/DME")
    .replace(/LOCDME/gi, "LOC/DME")
    .replace(/VORDME/gi, "VOR/DME")
    .replace(/NDBDME/gi, "NDB/DME")
    .replace(/\bCAT-\s*/gi, "CAT-");
}

export function formatSidStarChartName(chartName: string): string {
  const cleaned = normalizeWhitespace(chartName);

  if (isAlreadyFormatted(cleaned)) {
    return cleaned;
  }

  return normalizeWhitespace(
    cleaned
      .replace(
        /^(RNP|RNAV|ILS|VOR|NDB|LOC)RWY(\d{1,2}[LRC]?(?:\d{2}[LRC]?)*)/i,
        (_, type, runways) =>
          `${type.toUpperCase()} RWY ${formatRunwaySequence(runways)}`
      )
      .replace(/^RWY(\d{1,2}[LRC]?(?:\d{2}[LRC]?)*)/i, (_, runways) => {
        return `RWY ${formatRunwaySequence(runways)}`;
      })
      .replace(/\(([A-Z]{10,})\)/g, (_, waypoints) => {
        return `(${formatWaypointGroup(waypoints)})`;
      })
      .replace(/([^\s])(\()/g, "$1 $2")
  );
}

export function formatAppChartName(chartName: string): string {
  const withoutRunway = removeRunwayReference(normalizeWhitespace(chartName));
  const { base: withoutQualifiers, qualifiers } =
    extractTrailingParentheses(withoutRunway);
  const { base: withoutSuffix, suffix } =
    extractApproachSuffix(withoutQualifiers);

  const formatted = normalizeWhitespace(
    [normalizeApproachTokens(withoutSuffix), suffix, qualifiers]
      .filter(Boolean)
      .join(" ")
  );

  return formatted || normalizeWhitespace(chartName);
}

export function getFormattedChartName(chart: ChartData): string {
  const category = getChartCategory(chart.ChartTypeEx_CH);

  if (category === "APP") {
    return formatAppChartName(chart.ChartName);
  }

  if (category === "SID" || category === "STAR") {
    return formatSidStarChartName(chart.ChartName);
  }

  return chart.ChartName;
}
