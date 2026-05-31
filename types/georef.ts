export interface GeorefPageResult {
  page: number;
  georeferenced: boolean;
  transform: [number, number, number, number, number, number] | null;
  pageWidth: number;
  pageHeight: number;
  rmseMeters: number | null;
  controlPointCount: number;
}

export interface GeorefResult {
  chartId: string;
  pages: GeorefPageResult[];
}

export interface ChartGeoPoint {
  lon: number;
  lat: number;
}

export interface ChartCorners {
  west: number;
  east: number;
  south: number;
  north: number;
  topLeft: ChartGeoPoint;
  topRight: ChartGeoPoint;
  bottomRight: ChartGeoPoint;
  bottomLeft: ChartGeoPoint;
}
