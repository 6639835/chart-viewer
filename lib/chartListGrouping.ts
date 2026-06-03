import type { ChartCategory, ChartData } from "@/types/chart";

// Extract runway information from chart name.
function extractRunways(chartName: string): string[] {
  const runways: string[] = [];

  // Check if chart name contains spaces (new format) or not (old format).
  const hasSpaces = chartName.replace(/\([^)]*\)/g, "").includes(" ");

  if (hasSpaces) {
    // New format: "RNP ILS/DME z RW 24", "RNAV RWY 01/36L/36R", "RW 18L".
    const rwyMatch = chartName.match(
      /RW(?:Y)?\s*(\d{2}[LRC]?(?:\/\d{2}[LRC]?)*)/i
    );
    if (rwyMatch) {
      const rwyString = rwyMatch[1];
      const parts = rwyString.split("/");
      runways.push(...parts.map((p) => p.trim()));
    }
  } else {
    // Old format: RWY followed by runway numbers, e.g. RWY0136L36R.
    const rwyMatch = chartName.match(
      /RWY(\d{2}(?:[LRC])?(?:\d{2}(?:[LRC])?)*)/i
    );
    if (rwyMatch) {
      const rwyString = rwyMatch[1];
      const matches = rwyString.match(/\d{2}[LRC]?/g);
      if (matches) {
        runways.push(...matches);
      }
    }
  }

  return runways;
}

export function groupChartsByRunway(
  charts: ChartData[]
): Map<string, ChartData[]> {
  const grouped = new Map<string, ChartData[]>();

  charts.forEach((chart) => {
    const runways = extractRunways(chart.ChartName);

    if (runways.length > 0) {
      runways.forEach((runway) => {
        if (!grouped.has(runway)) {
          grouped.set(runway, []);
        }
        grouped.get(runway)!.push(chart);
      });
    } else {
      if (!grouped.has("其他")) {
        grouped.set("其他", []);
      }
      grouped.get("其他")!.push(chart);
    }
  });

  return grouped;
}

export function getChartListDisplayCount(
  charts: ChartData[],
  category: ChartCategory
): number {
  if (category === "TAXI") {
    return charts.length;
  }

  return Array.from(groupChartsByRunway(charts).values()).reduce(
    (count, runwayCharts) => count + runwayCharts.length,
    0
  );
}

// Sort TAXI charts by PAGE_NUMBER, e.g. 2A, 2B, 2C.
export function sortTaxiCharts(charts: ChartData[]): ChartData[] {
  return [...charts].sort((a, b) => {
    const pageA = a.PAGE_NUMBER;
    const pageB = b.PAGE_NUMBER;

    const parsePageNumber = (page: string) => {
      // Match patterns like: 2A, 2A-1, 2R01, 0G-1, 2C-1-SUP.
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

    if (parsedA.prefix !== parsedB.prefix) {
      return parsedA.prefix - parsedB.prefix;
    }

    if (parsedA.letter !== parsedB.letter) {
      return parsedA.letter.localeCompare(parsedB.letter);
    }

    if (parsedA.suffix !== parsedB.suffix) {
      return parsedA.suffix.localeCompare(parsedB.suffix);
    }

    return parsedA.rest.localeCompare(parsedB.rest);
  });
}
