import type { ChartCorners } from "@/types/georef";

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

/**
 * Project a (lon, lat) world position onto PDF page pixel coordinates,
 * using the inverse of the mupdf→Mercator affine transform.
 * Returns [x, y] in PDF pixels (top-left origin), or null if the transform
 * is singular or the position is outside the page bounds.
 */
export function worldToPdfPixels(
  transform: [number, number, number, number, number, number],
  pageWidth: number,
  pageHeight: number,
  lon: number,
  lat: number
): [number, number] | null {
  // Convert lon/lat to Web Mercator
  const mx = lon * (Math.PI / 180) * EARTH_RADIUS;
  const my = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * EARTH_RADIUS;

  // Affine forward: [mx, my] = [a, c, e; b, d, f] * [x, y, 1]
  const [a, b, c, d, e, f] = transform;
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
  if (x < -margin || x > pageWidth + margin || y < -margin || y > pageHeight + margin) return null;

  return [x, y];
}

/**
 * Compute the geographic bounding box of a PDF page given its mupdf→Mercator transform.
 * mupdf origin is top-left: (0,0)=TL, (w,0)=TR, (w,h)=BR, (0,h)=BL
 */
export function computePageCorners(
  transform: [number, number, number, number, number, number],
  pageWidth: number,
  pageHeight: number
): ChartCorners {
  const [topLeft, topRight, bottomRight, bottomLeft] = [
    applyTransform(transform, 0, 0),
    applyTransform(transform, pageWidth, 0),
    applyTransform(transform, pageWidth, pageHeight),
    applyTransform(transform, 0, pageHeight),
  ].map(([mx, my]) => mercatorToLonLat(mx, my));
  const corners = [topLeft, topRight, bottomRight, bottomLeft];

  const lons = corners.map(([lon]) => lon);
  const lats = corners.map(([, lat]) => lat);
  const { west, east } = longitudeBounds(lons);

  return {
    west,
    east,
    south: Math.min(...lats),
    north: Math.max(...lats),
    topLeft: { lon: topLeft[0], lat: topLeft[1] },
    topRight: { lon: topRight[0], lat: topRight[1] },
    bottomRight: { lon: bottomRight[0], lat: bottomRight[1] },
    bottomLeft: { lon: bottomLeft[0], lat: bottomLeft[1] },
  };
}
