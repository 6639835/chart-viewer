import { ChartData, ChartCategory, CHART_TYPE_MAPPING } from "@/types/chart";

// Parse CAT roman numerals (handles I/II, II/III, I/II/IIIA patterns)
function parseCATRomanNumerals(roman: string): string {
  // Check if ends with AI or A (indicates IIIA category)
  const hasAI = roman.endsWith("AI");
  const hasA = roman.endsWith("A");

  // If it has A or AI suffix, it's a three-category standard: I/II/IIIA
  if (hasAI || hasA) {
    return "I/II/IIIA";
  }

  // Count consecutive I's for non-A cases
  const iCount = roman.length;

  // Map patterns to their display format
  // IIII (4 I's) -> I/II
  // IIIIII (6 I's) -> II/III
  // III (3 I's) -> III

  if (iCount === 4) {
    return "I/II";
  } else if (iCount === 6) {
    return "II/III";
  } else if (iCount === 3) {
    return "III";
  } else if (iCount === 2) {
    return "II";
  } else if (iCount === 1) {
    return "I";
  }

  // Default: return as-is
  return roman;
}

// Format SID/STAR chart names for better readability
export function formatSidStarChartName(chartName: string): string {
  let formatted = chartName;

  // Handle different procedure types before RWY
  // Pattern: RNAVRWY0136L36R(GUVBAOSUBA) -> RNAV RWY 01/36L/36R (GUVBA/OSUBA)
  formatted = formatted.replace(
    /^(RNP|RNAV|ILS|VOR|NDB|LOC)RWY(\d{1,2}[LRC]?(?:\d{2}[LRC]?)*)/gi,
    (match, type, rwy) => {
      // Split runway numbers and add slashes (e.g., 0136L36R -> 01/36L/36R)
      const runwayParts = rwy.match(/\d{2}[LRC]?/g);
      if (runwayParts) {
        const formattedRwy = runwayParts.join("/");
        return `${type.toUpperCase()} RWY ${formattedRwy}`;
      }
      return `${type.toUpperCase()} RWY ${rwy}`;
    }
  );

  // Handle standalone RWY without prefix (e.g., RWY09 -> RWY 09, RWY18L -> RWY 18L)
  formatted = formatted.replace(
    /^RWY(\d{1,2}[LRC]?(?:\d{2}[LRC]?)*)/gi,
    (match, rwy) => {
      // Split runway numbers and add slashes if multiple runways
      const runwayParts = rwy.match(/\d{2}[LRC]?/g);
      if (runwayParts) {
        const formattedRwy = runwayParts.join("/");
        return `RWY ${formattedRwy}`;
      }
      return `RWY ${rwy}`;
    }
  );

  // Handle waypoints in parentheses: (GUVBAOSUBA) -> (GUVBA/OSUBA)
  formatted = formatted.replace(/\(([A-Z]{10,})\)/g, (match, waypoints) => {
    // Split waypoints (typically 5 characters each)
    const waypointParts = waypoints.match(/.{1,5}/g);
    if (waypointParts && waypointParts.length > 1) {
      return `(${waypointParts.join("/")})`;
    }
    return match;
  });

  // Add space before opening parenthesis
  formatted = formatted.replace(/([^\s])(\()/g, "$1 $2");

  return formatted;
}

// Format APP chart names for better readability
export function formatAppChartName(chartName: string): string {
  // Remove RWY and runway numbers (e.g., RWY01, RWY18L, RWY36R)
  let formatted = chartName.replace(/RWY\d{2}[LRC]?/gi, "").trim();

  // Handle lowercase w, z, y, x suffixes FIRST (before processing parentheses)
  const suffixMatch = formatted.match(/([wzyx])(?=\(|$)/i);
  const suffix = suffixMatch ? ` ${suffixMatch[1].toUpperCase()}` : "";
  if (suffixMatch) {
    formatted = formatted.replace(/([wzyx])(?=\(|$)/i, "").trim();
  }

  // Extract final waypoint/fix parentheses (last one, usually a waypoint like DUMIX, ELNUN)
  const finalParenMatch = formatted.match(/(\([^)]+\))$/);
  const finalParen = finalParenMatch ? finalParenMatch[1] : "";
  if (finalParenMatch) {
    formatted = formatted.replace(/\([^)]+\)$/, "").trim();
  }

  // Process the main part using specific patterns
  // Important: Match more specific patterns first before generic ones

  if (/^RNAVCAT/i.test(formatted)) {
    // RNAVCAT-IIIILSDMEz -> RNAV CAT-I/II ILS/DME
    formatted = formatted
      .replace(/^RNAV/i, "RNAV ")
      .replace(/CAT-?([I]+A?I?)LSDME/i, (match, roman) => {
        const parsed = parseCATRomanNumerals(roman.toUpperCase());
        return `CAT-${parsed} ILS/DME`;
      });
    if (formatted.includes("ILSDME")) {
      formatted = formatted.replace(/CAT-?([I]+A?)ILSDME/i, (match, roman) => {
        const parsed = parseCATRomanNumerals(roman.toUpperCase());
        return `CAT-${parsed} ILS/DME`;
      });
    }
  } else if (/^RNAVILSDME/i.test(formatted)) {
    // RNAVILSDME -> RNAV ILS/DME
    formatted = "RNAV ILS/DME";
  } else if (/^RNAV/i.test(formatted)) {
    // Other RNAV patterns
    formatted = formatted.replace(/^RNAV/i, "RNAV").replace(/DME/i, "/DME");
  } else if (/^RNPCAT/i.test(formatted)) {
    // RNPCAT-IIIILSDMEx -> RNP CAT-I/II ILS/DME
    formatted = formatted
      .replace(/^RNP/i, "RNP ")
      .replace(/CAT-?([I]+A?I?)LSDME/i, (match, roman) => {
        const parsed = parseCATRomanNumerals(roman.toUpperCase());
        return `CAT-${parsed} ILS/DME`;
      });
    if (formatted.includes("ILSDME")) {
      formatted = formatted.replace(/CAT-?([I]+A?)ILSDME/i, (match, roman) => {
        const parsed = parseCATRomanNumerals(roman.toUpperCase());
        return `CAT-${parsed} ILS/DME`;
      });
    }
  } else if (/^RNP\(AR\)ILSDME/i.test(formatted)) {
    // RNP(AR)ILSDMEw -> RNP (AR) ILS/DME
    formatted = formatted.replace(/^RNP\(AR\)ILSDME/i, "RNP (AR) ILS/DME");
  } else if (/^RNP\(AR\)ILS/i.test(formatted)) {
    // RNP(AR)ILSz -> RNP (AR) ILS
    formatted = formatted.replace(/^RNP\(AR\)ILS/i, "RNP (AR) ILS");
  } else if (/^RNPLOCDME/i.test(formatted)) {
    // RNPLOCDMEz -> RNP LOC/DME
    formatted = "RNP LOC/DME";
  } else if (/^RNPILSDME/i.test(formatted)) {
    // RNPILSDME(AR) or RNPILSDME -> RNP ILS/DME (AR) or RNP ILS/DME
    const arMatch = formatted.match(/\(AR\)$/i);
    formatted = "RNP ILS/DME";
    if (arMatch) {
      formatted = formatted + " (AR)";
    }
  } else if (/^RNPILS/i.test(formatted)) {
    // RNPILSx -> RNP ILS
    formatted = "RNP ILS";
  } else if (/^RNP/i.test(formatted)) {
    // RNP with optional (AR) or standalone
    // Handle: RNP(AR) -> RNP Y (AR) (suffix goes BEFORE (AR))
    const arMatch = formatted.match(/^RNP\(AR\)/i);
    if (arMatch) {
      formatted = `RNP${suffix} (AR)`.trim();
      // Mark that suffix is already added
      formatted = formatted.replace(/\s+/g, " ");
    } else {
      formatted = "RNP";
    }
  } else if (/^LOCDME/i.test(formatted)) {
    // LOCDME -> LOC/DME
    formatted = "LOC/DME";
  } else if (/^LOC/i.test(formatted)) {
    // Standalone LOC
    formatted = "LOC";
  } else if (/^ILSDME/i.test(formatted)) {
    // ILSDME -> ILS/DME
    formatted = "ILS/DME";
  } else if (/^ILS/i.test(formatted)) {
    // Standalone ILS
    formatted = "ILS";
  } else if (/^VORDME/i.test(formatted)) {
    // VORDME -> VOR/DME
    formatted = "VOR/DME";
  } else if (/^VOR/i.test(formatted)) {
    // Standalone VOR
    formatted = "VOR";
  } else if (/^NDBDME/i.test(formatted)) {
    // NDBDME -> NDB/DME
    formatted = "NDB/DME";
  } else if (/^NDB/i.test(formatted)) {
    // Standalone NDB
    formatted = "NDB";
  }

  // Add suffix back (unless it contains it already from RNP(AR) case)
  if (!formatted.includes(suffix.trim()) || suffix === "") {
    formatted = formatted + suffix;
  }

  // Clean up multiple spaces
  formatted = formatted.replace(/\s+/g, " ").trim();

  // Re-add final parentheses (waypoint/fix) if it exists
  if (finalParen) {
    formatted = `${formatted} ${finalParen}`;
  }

  // Clean up multiple spaces again
  formatted = formatted.replace(/\s+/g, " ").trim();

  return formatted;
}

// Get the formatted chart name based on chart type
export function getFormattedChartName(chart: ChartData): string {
  const category = CHART_TYPE_MAPPING[chart.ChartTypeEx_CH] as ChartCategory;

  if (category === "APP") {
    return formatAppChartName(chart.ChartName);
  }

  if (category === "SID" || category === "STAR") {
    return formatSidStarChartName(chart.ChartName);
  }

  return chart.ChartName;
}
