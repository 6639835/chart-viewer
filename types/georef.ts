export interface GeorefPolynomialAxis {
  x: number[];
  y: number[];
}

export interface GeorefHighAccuracyTransform {
  type: "local_polynomial";
  degree: number;
  terms: [number, number][];
  pdfOrigin: [number, number];
  pdfScale: number;
  originLon: number;
  originLat: number;
  geoScale: number;
  forward: GeorefPolynomialAxis;
  inverse: GeorefPolynomialAxis;
  projection?: {
    type: string;
    earthRadiusM?: number;
  };
  rmseMeters?: number;
  maxErrorMeters?: number;
  inlierCount?: number;
  controlPointCount?: number;
}

export interface GeorefControlPoint {
  waypoint: string;
  source: string;
  mupdfX: number;
  mupdfY: number;
  lon: number;
  lat: number;
  used: boolean;
  residualMeters: number | null;
}

export interface GeorefVectorPath {
  points: [number, number][];
  lineWidth?: number | null;
  stroke?: [number, number, number] | null;
}

export interface GeorefPageResult {
  page: number;
  georeferenced: boolean;
  transform: [number, number, number, number, number, number] | null;
  transformType?: string | null;
  highAccuracyTransform?: GeorefHighAccuracyTransform | null;
  pageWidth: number;
  pageHeight: number;
  rmseMeters: number | null;
  maxErrorMeters?: number | null;
  inlierCount?: number | null;
  controlPointCount: number;
  controlPoints?: GeorefControlPoint[] | null;
  vectorPaths?: GeorefVectorPath[] | null;
}

export interface GeorefResult {
  chartId: string;
  pages: GeorefPageResult[];
}

export interface ChartGeoPoint {
  lon: number;
  lat: number;
}

export interface ChartOverlayMeshVertex extends ChartGeoPoint {
  u: number;
  v: number;
}

export interface ChartOverlayMesh {
  columns?: number;
  rows?: number;
  vertices: ChartOverlayMeshVertex[];
  triangles?: [number, number, number][];
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
  mesh?: ChartOverlayMesh;
}

export interface ChartProcedurePoint extends ChartGeoPoint {
  waypoint: string;
  source: string;
  residualMeters: number | null;
}

export interface ChartProcedurePath {
  positions: ChartGeoPoint[];
  lineWidth: number;
  stroke?: [number, number, number] | null;
}

export interface ChartProcedureOverlay {
  points: ChartProcedurePoint[];
  paths: ChartProcedurePath[];
}
