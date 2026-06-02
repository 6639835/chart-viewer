import type {
  ChartCorners,
  ChartProcedureOverlay,
  GeorefHighAccuracyTransform,
  GeorefPageResult,
} from "@/types/georef";

const EARTH_RADIUS = 6_378_137.0;

function mercatorToLonLat(x: number, y: number): [number, number] {
  const lon = normalizeLongitude((x / EARTH_RADIUS) * (180 / Math.PI));
  const lat =
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

function normalizeLongitude(lon: number) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function longitudeBounds(lons: number[]) {
  const normalized = lons.map(normalizeLongitude);
  const as360 = normalized
    .map((lon) => (lon < 0 ? lon + 360 : lon))
    .sort((a, b) => a - b);

  let largestGap = -1;
  let gapEndIndex = 0;
  for (let index = 0; index < as360.length; index += 1) {
    const current = as360[index];
    const next =
      as360[(index + 1) % as360.length] +
      (index === as360.length - 1 ? 360 : 0);
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      gapEndIndex = (index + 1) % as360.length;
    }
  }

  const west360 = as360[gapEndIndex];
  const east360 =
    as360[(gapEndIndex + as360.length - 1) % as360.length] < west360
      ? as360[(gapEndIndex + as360.length - 1) % as360.length] + 360
      : as360[(gapEndIndex + as360.length - 1) % as360.length];

  return {
    west: normalizeLongitude(west360),
    east: normalizeLongitude(east360),
  };
}

function applyTransform(
  t: [number, number, number, number, number, number],
  x: number,
  y: number
): [number, number] {
  const [a, b, c, d, e, f] = t;
  return [a * x + c * y + e, b * x + d * y + f];
}

function evalPolynomial(
  coefficients: number[],
  terms: [number, number][],
  x: number,
  y: number
) {
  return coefficients.reduce((sum, coefficient, index) => {
    const [xPower, yPower] = terms[index];
    return sum + coefficient * x ** xPower * y ** yPower;
  }, 0);
}

function localMetersToLonLat(
  east: number,
  north: number,
  model: GeorefHighAccuracyTransform
): [number, number] {
  const radius = model.projection?.earthRadiusM ?? EARTH_RADIUS;
  const cosLat = Math.max(Math.cos((model.originLat * Math.PI) / 180), 1e-6);
  const lon = normalizeLongitude(
    model.originLon + (east / (radius * cosLat)) * (180 / Math.PI)
  );
  const lat = model.originLat + (north / radius) * (180 / Math.PI);
  return [lon, lat];
}

function lonLatToLocalMeters(
  lon: number,
  lat: number,
  model: GeorefHighAccuracyTransform
): [number, number] {
  const radius = model.projection?.earthRadiusM ?? EARTH_RADIUS;
  const cosLat = Math.max(Math.cos((model.originLat * Math.PI) / 180), 1e-6);
  const east =
    ((normalizeLongitude(lon - model.originLon) * Math.PI) / 180) *
    radius *
    cosLat;
  const north = (((lat - model.originLat) * Math.PI) / 180) * radius;
  return [east, north];
}

function applyHighAccuracyTransform(
  model: GeorefHighAccuracyTransform,
  x: number,
  y: number
): [number, number] {
  const nx = (x - model.pdfOrigin[0]) / model.pdfScale;
  const ny = (y - model.pdfOrigin[1]) / model.pdfScale;
  const ux = evalPolynomial(model.forward.x, model.terms, nx, ny);
  const uy = evalPolynomial(model.forward.y, model.terms, nx, ny);
  return localMetersToLonLat(ux * model.geoScale, uy * model.geoScale, model);
}

function pagePointToLonLat(
  page: GeorefPageResult,
  x: number,
  y: number
): [number, number] | null {
  if (page.highAccuracyTransform) {
    return applyHighAccuracyTransform(page.highAccuracyTransform, x, y);
  }
  if (!page.transform) return null;
  return mercatorToLonLat(...applyTransform(page.transform, x, y));
}

function finiteNumber(value: number) {
  return Number.isFinite(value);
}

function getGeographicPdfBounds(page: GeorefPageResult) {
  const usedControls =
    page.controlPoints?.filter(
      (point) =>
        point.used &&
        finiteNumber(point.mupdfX) &&
        finiteNumber(point.mupdfY)
    ) ?? [];

  if (usedControls.length < 4) {
    return {
      left: 0,
      top: 0,
      right: page.pageWidth,
      bottom: page.pageHeight,
    };
  }

  const xs = usedControls.map((point) => point.mupdfX);
  const ys = usedControls.map((point) => point.mupdfY);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const marginX = clamp(spanX * 0.12, 30, 80);
  const marginY = clamp(spanY * 0.12, 30, 80);

  return {
    left: clamp(minX - marginX, 0, page.pageWidth),
    top: clamp(minY - marginY, 0, page.pageHeight),
    right: clamp(maxX + marginX, 0, page.pageWidth),
    bottom: clamp(maxY + marginY, 0, page.pageHeight),
  };
}

type PdfControlPoint = { x: number; y: number };

function cross(o: PdfControlPoint, a: PdfControlPoint, b: PdfControlPoint) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: PdfControlPoint[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 1) return sorted;

  const lower: PdfControlPoint[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: PdfControlPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function expandPolygon(
  points: PdfControlPoint[],
  pageWidth: number,
  pageHeight: number,
  margin: number
) {
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };

  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: clamp(point.x + (dx / length) * margin, 0, pageWidth),
      y: clamp(point.y + (dy / length) * margin, 0, pageHeight),
    };
  });
}

function getGeographicPdfPolygon(page: GeorefPageResult) {
  const usedControls =
    page.controlPoints?.filter(
      (point) =>
        point.used &&
        finiteNumber(point.mupdfX) &&
        finiteNumber(point.mupdfY)
    ) ?? [];

  if (usedControls.length < 4) return null;

  const hull = convexHull(
    usedControls.map((point) => ({ x: point.mupdfX, y: point.mupdfY }))
  );
  if (hull.length < 3) return null;

  const bounds = getGeographicPdfBounds(page);
  const margin = clamp(
    Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.08,
    18,
    45
  );
  return expandPolygon(hull, page.pageWidth, page.pageHeight, margin);
}

/**
 * Project a (lon, lat) world position onto PDF page pixel coordinates,
 * using the best available inverse transform.
 * Returns [x, y] in PDF pixels (top-left origin), or null if the transform
 * is singular or the position is outside the page bounds.
 */
export function worldToPdfPixels(
  page: GeorefPageResult,
  lon: number,
  lat: number
): [number, number] | null {
  if (page.highAccuracyTransform) {
    const model = page.highAccuracyTransform;
    const [east, north] = lonLatToLocalMeters(lon, lat, model);
    const ux = east / model.geoScale;
    const uy = north / model.geoScale;
    const nx = evalPolynomial(model.inverse.x, model.terms, ux, uy);
    const ny = evalPolynomial(model.inverse.y, model.terms, ux, uy);
    const x = model.pdfOrigin[0] + nx * model.pdfScale;
    const y = model.pdfOrigin[1] + ny * model.pdfScale;
    const margin = 10;
    if (
      x < -margin ||
      x > page.pageWidth + margin ||
      y < -margin ||
      y > page.pageHeight + margin
    ) {
      return null;
    }
    return [x, y];
  }

  if (!page.transform) return null;
  // Convert lon/lat to Web Mercator
  const mx = lon * (Math.PI / 180) * EARTH_RADIUS;
  const my = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * EARTH_RADIUS;

  // Affine forward: [mx, my] = [a, c, e; b, d, f] * [x, y, 1]
  const [a, b, c, d, e, f] = page.transform;
  // Solve 2×2 system for (x, y):
  //   a*x + c*y = mx - e
  //   b*x + d*y = my - f
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const rx = mx - e;
  const ry = my - f;
  const x = (d * rx - c * ry) / det;
  const y = (a * ry - b * rx) / det;

  // Clamp to page bounds with a small margin to avoid false negatives at edges
  const margin = 10;
  if (x < -margin || x > page.pageWidth + margin || y < -margin || y > page.pageHeight + margin) return null;

  return [x, y];
}

/**
 * Compute the geographic overlay region for a georeferenced PDF page.
 * Procedure PDFs include non-geographic headers, tables, and title blocks, so
 * the map overlay is clipped to the used-control region instead of the full page.
 */
export function computePageCorners(
  page: GeorefPageResult
): ChartCorners {
  const pageWidth = page.pageWidth;
  const pageHeight = page.pageHeight;
  const bounds = getGeographicPdfBounds(page);
  const topLeft = pagePointToLonLat(page, bounds.left, bounds.top) ?? [0, 0];
  const topRight = pagePointToLonLat(page, bounds.right, bounds.top) ?? [0, 0];
  const bottomRight = pagePointToLonLat(page, bounds.right, bounds.bottom) ?? [0, 0];
  const bottomLeft = pagePointToLonLat(page, bounds.left, bounds.bottom) ?? [0, 0];
  const corners = [topLeft, topRight, bottomRight, bottomLeft];

  const samples = [...corners];
  for (let i = 1; i < 8; i += 1) {
    const tx = bounds.left + ((bounds.right - bounds.left) * i) / 8;
    const ty = bounds.top + ((bounds.bottom - bounds.top) * i) / 8;
    const edgeSamples = [
      pagePointToLonLat(page, tx, bounds.top),
      pagePointToLonLat(page, bounds.right, ty),
      pagePointToLonLat(page, bounds.right - (tx - bounds.left), bounds.bottom),
      pagePointToLonLat(page, bounds.left, bounds.bottom - (ty - bounds.top)),
    ].filter((point): point is [number, number] => point !== null);
    samples.push(...edgeSamples);
  }

  const lons = samples.map(([lon]) => lon);
  const lats = samples.map(([, lat]) => lat);
  const { west, east } = longitudeBounds(lons);

  const mesh = (() => {
    const polygon = getGeographicPdfPolygon(page);
    if (polygon) {
      const vertices = polygon
        .map((pdfPoint) => {
          const point = pagePointToLonLat(page, pdfPoint.x, pdfPoint.y);
          if (!point) return null;
          return {
            lon: point[0],
            lat: point[1],
            u: pdfPoint.x / pageWidth,
            v: pdfPoint.y / pageHeight,
          };
        })
        .filter((vertex): vertex is NonNullable<typeof vertex> => vertex !== null);

      if (vertices.length === polygon.length && vertices.length >= 3) {
        const triangles: [number, number, number][] = [];
        for (let index = 1; index < vertices.length - 1; index += 1) {
          triangles.push([0, index, index + 1]);
        }
        return { vertices, triangles };
      }
    }

    const columns = 9;
    const rows = 9;
    const vertices = [];
    for (let row = 0; row < rows; row += 1) {
      const rowFraction = row / (rows - 1);
      const y = bounds.top + (bounds.bottom - bounds.top) * rowFraction;
      for (let column = 0; column < columns; column += 1) {
        const columnFraction = column / (columns - 1);
        const x = bounds.left + (bounds.right - bounds.left) * columnFraction;
        const point = pagePointToLonLat(page, x, y);
        if (!point) return undefined;
        vertices.push({
          lon: point[0],
          lat: point[1],
          u: x / pageWidth,
          v: y / pageHeight,
        });
      }
    }
    return { columns, rows, vertices };
  })();

  return {
    west,
    east,
    south: Math.min(...lats),
    north: Math.max(...lats),
    topLeft: { lon: topLeft[0], lat: topLeft[1] },
    topRight: { lon: topRight[0], lat: topRight[1] },
    bottomRight: { lon: bottomRight[0], lat: bottomRight[1] },
    bottomLeft: { lon: bottomLeft[0], lat: bottomLeft[1] },
    mesh,
  };
}

export function computeProcedureOverlay(
  page: GeorefPageResult
): ChartProcedureOverlay {
  const points =
    page.controlPoints
      ?.filter((point) => point.used && finiteNumber(point.lon) && finiteNumber(point.lat))
      .map((point) => ({
        waypoint: point.waypoint,
        source: point.source,
        lon: point.lon,
        lat: point.lat,
        residualMeters: point.residualMeters,
      })) ?? [];

  const paths =
    page.vectorPaths
      ?.map((path) => {
        const positions = path.points
          .map(([x, y]) => pagePointToLonLat(page, x, y))
          .filter((point): point is [number, number] => point !== null)
          .map(([lon, lat]) => ({ lon, lat }));
        if (positions.length < 2) return null;
        return {
          positions,
          lineWidth: clamp(path.lineWidth ?? 1.5, 1, 6),
          stroke: path.stroke ?? null,
        };
      })
      .filter((path): path is NonNullable<typeof path> => path !== null) ?? [];

  return { points, paths };
}
