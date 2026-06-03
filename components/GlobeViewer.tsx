"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Home,
  Layers,
  Loader2,
  Minus,
  Navigation,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { ChartCorners, ChartOverlayMesh } from "@/types/georef";
import type { AirportCoord } from "@/lib/tauriClient";
import type { OwnshipPosition } from "@/lib/gdl90";

export interface ChartOverlayData {
  chartId: string;
  pageNumber: number;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  corners: ChartCorners;
}

interface GlobeViewerProps {
  onClose: () => void;
  targetAirport?: string;
  chartOverlay?: ChartOverlayData | null;
  chartOverlayLoading?: boolean;
  airportCoords?: AirportCoord[];
  ownshipPosition?: OwnshipPosition | null;
}

function formatAltitude(meters: number): string {
  if (meters >= 1_000_000) return `${(meters / 1_000_000).toFixed(1)} Mm`;
  if (meters >= 1_000) return `${(meters / 1_000).toFixed(0)} km`;
  return `${meters.toFixed(0)} m`;
}

function formatDeg(deg: number, pos: string, neg: string): string {
  const dir = deg >= 0 ? pos : neg;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = Math.round(((abs - d) * 60 - m) * 60);
  return `${d}°${m.toString().padStart(2, "0")}'${s.toString().padStart(2, "0")}" ${dir}`;
}

// Tile layers available to switch between
const LAYERS = [
  { id: "osm", label: "OSM", url: "https://tile.openstreetmap.org/" },
  { id: "topo", label: "Topo", url: "https://tile.opentopomap.org/" },
];

type GlobeViewerInstance = {
  camera: {
    positionCartographic: {
      longitude: number;
      latitude: number;
      height: number;
    };
    heading: number;
    getPickRay: (
      windowPosition: import("cesium").Cartesian2
    ) => import("cesium").Ray | undefined;
    pickEllipsoid: (
      windowPosition: import("cesium").Cartesian2,
      ellipsoid?: import("cesium").Ellipsoid
    ) => import("cesium").Cartesian3 | undefined;
    setView: (options: {
      destination?: import("cesium").Cartesian3;
      orientation?: { heading: number; pitch: number; roll: number };
    }) => void;
    zoomIn: (amount?: number) => void;
    zoomOut: (amount?: number) => void;
    moveRight: (amount?: number) => void;
    moveUp: (amount?: number) => void;
    rotateLeft: (angle?: number) => void;
    rotateRight: (angle?: number) => void;
    rotateUp: (angle?: number) => void;
    rotateDown: (angle?: number) => void;
  };
  scene?: {
    canvas: HTMLCanvasElement;
    globe: {
      ellipsoid: import("cesium").Ellipsoid;
      pick: (
        ray: import("cesium").Ray,
        scene: unknown
      ) => import("cesium").Cartesian3 | undefined;
    };
    requestRender?: () => void;
  };
};

const WHEEL_PINCH_ZOOM_SENSITIVITY = 0.006;
const MIN_CAMERA_HEIGHT_METERS = 250;
const MAX_CAMERA_HEIGHT_METERS = 25_000_000;
const AIRPORT_HOME_HEIGHT_METERS = 20_000;
const AIRCRAFT_CENTER_MIN_HEIGHT_METERS = 5_000;
const AIRCRAFT_CENTER_MAX_HEIGHT_METERS = 120_000;
const MAX_GLOBE_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_CHART_OVERLAY_ALPHA = 0.95;
const GLOBE_MAX_SCREEN_SPACE_ERROR = 2.5;
const GLOBE_TILE_CACHE_SIZE = 64;
const CAMERA_STATUS_UPDATE_MS = 120;
const CURSOR_STATUS_UPDATE_MS = 80;
const ALTITUDE_UPDATE_RATIO = 0.01;
const HEADING_UPDATE_DEGREES = 0.5;
const CURSOR_UPDATE_DEGREES = 0.00005;
const AIRCRAFT_MARKER_HEIGHT_METERS = 0;
const CHART_OVERLAY_HEIGHT_METERS = 150;

interface ClientPoint {
  clientX: number;
  clientY: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getGlobeViewer(viewer: unknown): GlobeViewerInstance | null {
  return viewer ? (viewer as GlobeViewerInstance) : null;
}

function getCameraHeight(viewer: GlobeViewerInstance) {
  return Math.max(viewer.camera.positionCartographic.height, 1);
}

function clampCameraHeight(height: number) {
  return clamp(height, MIN_CAMERA_HEIGHT_METERS, MAX_CAMERA_HEIGHT_METERS);
}

function normalizeGlobeCamera(
  viewer: GlobeViewerInstance,
  Cesium: typeof import("cesium"),
  height = clampCameraHeight(getCameraHeight(viewer))
) {
  const position = viewer.camera.positionCartographic;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      position.longitude,
      position.latitude,
      clampCameraHeight(height)
    ),
  });
}

function getGlobeCartographicAtClientPoint(
  viewer: GlobeViewerInstance,
  Cesium: typeof import("cesium"),
  clientPoint?: ClientPoint | null
) {
  if (!clientPoint || !viewer.scene) {
    return null;
  }

  const canvasRect = viewer.scene.canvas.getBoundingClientRect();
  const canvasPoint = new Cesium.Cartesian2(
    clientPoint.clientX - canvasRect.left,
    clientPoint.clientY - canvasRect.top
  );
  const ellipsoidPosition = viewer.camera.pickEllipsoid(
    canvasPoint,
    viewer.scene.globe.ellipsoid
  );
  if (ellipsoidPosition) {
    return Cesium.Cartographic.fromCartesian(ellipsoidPosition);
  }

  const ray = viewer.camera.getPickRay(canvasPoint);
  if (!ray) {
    return null;
  }

  const position = viewer.scene.globe.pick(ray, viewer.scene);
  return position ? Cesium.Cartographic.fromCartesian(position) : null;
}

function applyCursorZoomAnchor(
  viewer: GlobeViewerInstance,
  Cesium: typeof import("cesium"),
  anchorBefore: import("cesium").Cartographic | null,
  clientPoint: ClientPoint | null | undefined,
  height: number
) {
  if (!anchorBefore) {
    normalizeGlobeCamera(viewer, Cesium, height);
    return;
  }

  const anchorAfter = getGlobeCartographicAtClientPoint(
    viewer,
    Cesium,
    clientPoint
  );
  if (!anchorAfter) {
    normalizeGlobeCamera(viewer, Cesium, height);
    return;
  }

  const current = viewer.camera.positionCartographic;
  const nextLongitude = Cesium.Math.negativePiToPi(
    current.longitude +
      Cesium.Math.negativePiToPi(anchorBefore.longitude - anchorAfter.longitude)
  );
  const nextLatitude = clamp(
    current.latitude + (anchorBefore.latitude - anchorAfter.latitude),
    -Cesium.Math.PI_OVER_TWO + Cesium.Math.EPSILON6,
    Cesium.Math.PI_OVER_TWO - Cesium.Math.EPSILON6
  );

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(
      nextLongitude,
      nextLatitude,
      clampCameraHeight(height)
    ),
  });
}

function getAirportCoords(
  targetAirport?: string,
  airportCoords?: AirportCoord[]
): [number, number] | null {
  if (!targetAirport || !airportCoords) return null;
  const found = airportCoords.find((a) => a.icao === targetAirport);
  return found ? [found.lon, found.lat] : null;
}

function flyToAirportHome(
  viewer: {
    camera: {
      flyTo: (options: {
        destination: import("cesium").Cartesian3;
        orientation?: { heading: number; pitch: number; roll: number };
        duration?: number;
      }) => void;
    };
  },
  Cesium: typeof import("cesium"),
  coords: [number, number],
  duration = 0
) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      coords[0],
      coords[1],
      AIRPORT_HOME_HEIGHT_METERS
    ),
    duration,
  });
}

function flyToDefaultHome(
  viewer: {
    camera: {
      flyTo: (options: {
        destination: import("cesium").Cartesian3;
        orientation?: { heading: number; pitch: number; roll: number };
        duration?: number;
      }) => void;
    };
  },
  Cesium: typeof import("cesium"),
  duration = 0
) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(105, 35, 12_000_000),
    duration,
  });
}

function getChartOverlayRectangle(
  Cesium: typeof import("cesium"),
  chartOverlay: ChartOverlayData
) {
  const { corners } = chartOverlay;
  return Cesium.Rectangle.fromDegrees(
    corners.west,
    corners.south,
    corners.east,
    corners.north
  );
}

function getChartOverlayKey(chartOverlay: ChartOverlayData) {
  const { corners } = chartOverlay;
  return [
    chartOverlay.chartId,
    chartOverlay.pageNumber,
    chartOverlay.imageUrl,
    chartOverlay.imageWidth,
    chartOverlay.imageHeight,
    corners.topLeft.lon,
    corners.topLeft.lat,
    corners.topRight.lon,
    corners.topRight.lat,
    corners.bottomRight.lon,
    corners.bottomRight.lat,
    corners.bottomLeft.lon,
    corners.bottomLeft.lat,
    corners.mesh?.vertices.length,
    corners.mesh?.triangles?.length,
  ].join("|");
}

function chartOverlayFallbackMesh(
  chartOverlay: ChartOverlayData
): Required<Pick<ChartOverlayMesh, "vertices" | "triangles">> {
  const { corners } = chartOverlay;
  return {
    vertices: [
      { ...corners.topLeft, u: 0, v: 0 },
      { ...corners.topRight, u: 1, v: 0 },
      { ...corners.bottomRight, u: 1, v: 1 },
      { ...corners.bottomLeft, u: 0, v: 1 },
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

function getChartOverlayMesh(chartOverlay: ChartOverlayData) {
  const mesh = chartOverlay.corners.mesh;
  if (!mesh || mesh.vertices.length < 3) {
    return chartOverlayFallbackMesh(chartOverlay);
  }

  if (mesh.triangles?.length) {
    return { vertices: mesh.vertices, triangles: mesh.triangles };
  }

  if (!mesh.columns || !mesh.rows || mesh.columns < 2 || mesh.rows < 2) {
    return chartOverlayFallbackMesh(chartOverlay);
  }

  const triangles: [number, number, number][] = [];
  for (let row = 0; row < mesh.rows - 1; row += 1) {
    for (let column = 0; column < mesh.columns - 1; column += 1) {
      const topLeft = row * mesh.columns + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + mesh.columns;
      const bottomRight = bottomLeft + 1;
      triangles.push([topLeft, topRight, bottomRight]);
      triangles.push([topLeft, bottomRight, bottomLeft]);
    }
  }

  return { vertices: mesh.vertices, triangles };
}

function loadOverlayImage(imageUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Chart overlay image failed to load"));
    image.src = imageUrl;
  });
}

function createChartOverlayPrimitive(
  Cesium: typeof import("cesium"),
  chartOverlay: ChartOverlayData,
  image: HTMLImageElement,
  alpha: number
) {
  const mesh = getChartOverlayMesh(chartOverlay);
  const positions = new Float64Array(mesh.vertices.length * 3);
  const textureCoordinates = new Float32Array(mesh.vertices.length * 2);

  mesh.vertices.forEach((vertex, index) => {
    const cartesian = Cesium.Cartesian3.fromDegrees(
      vertex.lon,
      vertex.lat,
      CHART_OVERLAY_HEIGHT_METERS
    );
    positions[index * 3] = cartesian.x;
    positions[index * 3 + 1] = cartesian.y;
    positions[index * 3 + 2] = cartesian.z;
    textureCoordinates[index * 2] = clamp(vertex.u, 0, 1);
    textureCoordinates[index * 2 + 1] = clamp(1 - vertex.v, 0, 1);
  });

  const geometryAttributes = {
    position: new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions,
    }),
    st: new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: textureCoordinates,
    }),
  } as unknown as import("cesium").GeometryAttributes;

  const geometry = new Cesium.Geometry({
    attributes: geometryAttributes,
    indices:
      mesh.vertices.length > 65535
        ? new Uint32Array(mesh.triangles.flat())
        : new Uint16Array(mesh.triangles.flat()),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
  });

  const material = new Cesium.Material({
    fabric: {
      type: "Image",
      uniforms: {
        image,
        color: Cesium.Color.WHITE.withAlpha(clamp(alpha, 0.1, 1)),
      },
    },
  });

  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: new Cesium.EllipsoidSurfaceAppearance({
      material,
      translucent: true,
      aboveGround: true,
      flat: true,
      faceForward: true,
      renderState: {
        depthTest: { enabled: false },
        depthMask: false,
        cull: { enabled: false },
        blending: Cesium.BlendingState.ALPHA_BLEND,
      },
    }),
    asynchronous: false,
  });
}

function setChartOverlayPrimitiveAlpha(
  Cesium: typeof import("cesium"),
  primitive: unknown,
  alpha: number
) {
  const overlayPrimitive = primitive as {
    appearance?: {
      material?: { uniforms?: { color?: import("cesium").Color } };
    };
  };
  if (overlayPrimitive.appearance?.material?.uniforms) {
    overlayPrimitive.appearance.material.uniforms.color =
      Cesium.Color.WHITE.withAlpha(clamp(alpha, 0.1, 1));
  }
}

function flyToChartOverlay(
  viewer: {
    camera: {
      flyTo: (options: {
        destination: import("cesium").Rectangle;
        duration?: number;
      }) => void;
    };
  },
  Cesium: typeof import("cesium"),
  chartOverlay: ChartOverlayData,
  duration = 0.8
) {
  viewer.camera.flyTo({
    destination: getChartOverlayRectangle(Cesium, chartOverlay),
    duration,
  });
}

function flyToOwnship(
  viewer: {
    camera: {
      positionCartographic: { height: number };
      flyTo: (options: {
        destination: import("cesium").Cartesian3;
        orientation?: { heading: number; pitch: number; roll: number };
        duration?: number;
      }) => void;
    };
  },
  Cesium: typeof import("cesium"),
  ownshipPosition: OwnshipPosition,
  duration = 0.8
) {
  const currentHeight = clampCameraHeight(
    viewer.camera.positionCartographic.height
  );
  const centerHeight = clamp(
    currentHeight,
    AIRCRAFT_CENTER_MIN_HEIGHT_METERS,
    AIRCRAFT_CENTER_MAX_HEIGHT_METERS
  );

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      ownshipPosition.lon,
      ownshipPosition.lat,
      centerHeight
    ),
    duration,
  });
}

function getAircraftBillboardRotation(
  Cesium: typeof import("cesium"),
  trackDeg: number | null
) {
  return trackDeg !== null ? -Cesium.Math.toRadians(trackDeg) : 0;
}

function createOwnshipMarkerCanvas() {
  const iconSize = 48;
  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = iconSize;
  iconCanvas.height = iconSize;
  const ctx = iconCanvas.getContext("2d")!;
  const cx = iconSize / 2;
  const cy = iconSize / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 4;
  ctx.scale(1.65, 1.65);
  ctx.translate(-12, -12);

  ctx.fillStyle = "#3b82f6";
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(12, 2);
  ctx.lineTo(19, 21);
  ctx.lineTo(12, 17);
  ctx.lineTo(5, 21);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  ctx.restore();
  return iconCanvas;
}

function zoomGlobeByDirection(
  viewer: GlobeViewerInstance,
  direction: "in" | "out",
  fraction: number,
  Cesium?: typeof import("cesium") | null,
  clientPoint?: ClientPoint | null
) {
  const currentHeight = getCameraHeight(viewer);
  const boundedHeight = clampCameraHeight(currentHeight);
  const rawAmount = boundedHeight * clamp(fraction, 0.01, 0.35);

  const targetHeight =
    direction === "in"
      ? Math.max(MIN_CAMERA_HEIGHT_METERS, boundedHeight - rawAmount)
      : Math.min(MAX_CAMERA_HEIGHT_METERS, boundedHeight + rawAmount);
  const amount =
    direction === "in"
      ? Math.max(currentHeight - targetHeight, 0)
      : Math.max(targetHeight - currentHeight, 0);

  if (amount <= 0) {
    return;
  }

  if (Cesium) {
    normalizeGlobeCamera(viewer, Cesium, boundedHeight);
  }
  const anchorBefore = Cesium
    ? getGlobeCartographicAtClientPoint(viewer, Cesium, clientPoint)
    : null;

  if (direction === "in") {
    viewer.camera.zoomIn(amount);
  } else {
    viewer.camera.zoomOut(amount);
  }

  if (Cesium) {
    applyCursorZoomAnchor(
      viewer,
      Cesium,
      anchorBefore,
      clientPoint,
      targetHeight
    );
  }

  viewer.scene?.requestRender?.();
}

function panGlobeByWheel(
  viewer: GlobeViewerInstance,
  event: WheelEvent,
  Cesium?: typeof import("cesium") | null
) {
  if (!Cesium) return;

  normalizeGlobeCamera(viewer, Cesium);

  const height = clampCameraHeight(getCameraHeight(viewer));
  const canvasHeight = Math.max(viewer.scene?.canvas.clientHeight ?? 1, 1);
  const metersPerPixel = height / canvasHeight;
  const horizontal = clamp(event.deltaX, -120, 120) * metersPerPixel;
  const vertical = clamp(event.deltaY, -120, 120) * metersPerPixel;

  if (horizontal !== 0) viewer.camera.moveRight(horizontal);
  if (vertical !== 0) viewer.camera.moveUp(-vertical);

  normalizeGlobeCamera(viewer, Cesium, height);

  viewer.scene?.requestRender?.();
}

export default function GlobeViewer({
  onClose,
  targetAirport,
  chartOverlay,
  chartOverlayLoading = false,
  airportCoords,
  ownshipPosition,
}: GlobeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Store the full Cesium Viewer type at runtime but keep TS happy with unknown
  const viewerRef = useRef<unknown>(null);
  const cesiumRef = useRef<typeof import("cesium") | null>(null);
  const baseLayerRef = useRef<unknown>(null);
  const overlayLayerRef = useRef<unknown>(null);
  const activeOverlayImageUrlRef = useRef<string | null>(null);
  const chartOverlayAlphaRef = useRef(DEFAULT_CHART_OVERLAY_ALPHA);
  const altitudeRef = useRef<number | null>(null);
  const headingRef = useRef(0);
  const cursorCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const tilesLoadingRef = useRef(false);
  const aircraftEntityRef = useRef<unknown>(null);
  const aircraftIconCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [altitude, setAltitude] = useState<number | null>(null);
  const [heading, setHeading] = useState(0); // degrees, for compass needle
  const [cursorCoords, setCursorCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [activeLayer, setActiveLayer] = useState("osm");
  const [showLayerPicker, setShowLayerPicker] = useState(false);
  const [chartOverlayAlpha, setChartOverlayAlpha] = useState(
    DEFAULT_CHART_OVERLAY_ALPHA
  );
  const [viewerReadyKey, setViewerReadyKey] = useState(0);

  // Inject Cesium widget CSS once
  useEffect(() => {
    const id = "cesium-widgets-css";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "/cesium/Widgets/widgets.css";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    // Intercept trackpad input before Cesium sees it: pinch should zoom,
    // while regular two-finger scroll should pan instead of zoom.
    const el = containerRef.current;
    let lastGestureScale = 1;
    let lastClientPoint: ClientPoint | null = null;
    let screenSpaceHandler: import("cesium").ScreenSpaceEventHandler | null =
      null;
    let removeTileLoadListener: (() => void) | null = null;
    let removePostRenderListener: (() => void) | null = null;
    let lastCameraStatusUpdate = 0;
    let lastCursorStatusUpdate = 0;

    const getEventClientPoint = (event: Event): ClientPoint | null => {
      const pointer = event as Event & {
        clientX?: number;
        clientY?: number;
      };

      if (
        typeof pointer.clientX === "number" &&
        typeof pointer.clientY === "number"
      ) {
        lastClientPoint = {
          clientX: pointer.clientX,
          clientY: pointer.clientY,
        };
        return lastClientPoint;
      }

      return lastClientPoint;
    };

    const handlePointerMove = (event: PointerEvent) => {
      lastClientPoint = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      getEventClientPoint(e);
      lastGestureScale = 1;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const scale = (e as unknown as { scale: number }).scale;
      const delta = scale / lastGestureScale;
      lastGestureScale = scale;
      const viewer = getGlobeViewer(viewerRef.current);
      if (!viewer) return;

      const fraction = Math.abs(1 - delta);
      const clientPoint = getEventClientPoint(e);
      if (delta > 1) {
        zoomGlobeByDirection(
          viewer,
          "in",
          fraction,
          cesiumRef.current,
          clientPoint
        );
      } else if (delta < 1) {
        zoomGlobeByDirection(
          viewer,
          "out",
          fraction,
          cesiumRef.current,
          clientPoint
        );
      }
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      lastGestureScale = 1;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const viewer = getGlobeViewer(viewerRef.current);
      if (!viewer) return;

      if (event.ctrlKey || event.metaKey) {
        const fraction = Math.abs(event.deltaY) * WHEEL_PINCH_ZOOM_SENSITIVITY;
        zoomGlobeByDirection(
          viewer,
          event.deltaY < 0 ? "in" : "out",
          fraction,
          cesiumRef.current,
          getEventClientPoint(event)
        );
        return;
      }

      panGlobeByWheel(viewer, event, cesiumRef.current);
    };

    el.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("gesturestart", onGestureStart, { capture: true });
    el.addEventListener("gesturechange", onGestureChange, { capture: true });
    el.addEventListener("gestureend", onGestureEnd, { capture: true });

    async function init() {
      (window as typeof window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL =
        "/cesium/";
      const Cesium = await import("cesium");
      if (destroyed || !containerRef.current) return;

      cesiumRef.current = Cesium;

      const layer = LAYERS.find((l) => l.id === activeLayer) ?? LAYERS[0];
      const osmProvider = new Cesium.OpenStreetMapImageryProvider({
        url: layer.url,
        credit: "© OpenStreetMap contributors",
      });
      const baseLayer = new Cesium.ImageryLayer(osmProvider);
      baseLayerRef.current = baseLayer;

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        skyBox: false,
        skyAtmosphere: false,
        infoBox: false,
        selectionIndicator: false,
        shadows: false,
        terrainShadows: Cesium.ShadowMode.DISABLED,
        orderIndependentTranslucency: false,
        sceneMode: Cesium.SceneMode.SCENE2D,
        scene3DOnly: false,
        mapProjection: new Cesium.WebMercatorProjection(),
        requestRenderMode: true,
        maximumRenderTimeChange: Number.POSITIVE_INFINITY,
        msaaSamples: 1,
        shouldAnimate: false,
        useBrowserRecommendedResolution: false,
      });

      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0a14");
      viewer.scene.postProcessStages.fxaa.enabled = false;
      viewer.scene.globe.maximumScreenSpaceError = GLOBE_MAX_SCREEN_SPACE_ERROR;
      viewer.scene.globe.tileCacheSize = GLOBE_TILE_CACHE_SIZE;
      viewer.resolutionScale = Math.min(
        window.devicePixelRatio || 1,
        MAX_GLOBE_DEVICE_PIXEL_RATIO
      );

      // 2D map input: pinch gesture = zoom, scroll = planar pan.
      const ctrl = viewer.scene.screenSpaceCameraController;
      ctrl.enableTilt = false;
      ctrl.enableRotate = false;
      ctrl.inertiaZoom = 0;
      ctrl.minimumZoomDistance = MIN_CAMERA_HEIGHT_METERS;
      ctrl.maximumZoomDistance = MAX_CAMERA_HEIGHT_METERS;
      ctrl.zoomEventTypes = [Cesium.CameraEventType.RIGHT_DRAG];
      ctrl.tiltEventTypes = undefined;
      ctrl.lookEventTypes = undefined;

      viewerRef.current = viewer;

      // Tile loading indicator
      removeTileLoadListener =
        viewer.scene.globe.tileLoadProgressEvent.addEventListener(
          (remaining: number) => {
            const loading = remaining > 0;
            if (tilesLoadingRef.current !== loading) {
              tilesLoadingRef.current = loading;
              setTilesLoading(loading);
            }
            viewer.scene.requestRender();
          }
        );

      // Post-render status is deliberately throttled; updating React state on
      // every Cesium frame dominates CPU while the camera is moving.
      removePostRenderListener = viewer.scene.postRender.addEventListener(
        () => {
          const now = performance.now();
          if (now - lastCameraStatusUpdate < CAMERA_STATUS_UPDATE_MS) {
            return;
          }
          lastCameraStatusUpdate = now;

          const cart = viewer.camera.positionCartographic;
          if (!cart) return;

          const nextAltitude = cart.height;
          const previousAltitude = altitudeRef.current;
          const altitudeChanged =
            previousAltitude === null ||
            Math.abs(nextAltitude - previousAltitude) >
              Math.max(10, previousAltitude * ALTITUDE_UPDATE_RATIO);

          if (altitudeChanged) {
            altitudeRef.current = nextAltitude;
            setAltitude(nextAltitude);
          }

          const nextHeading = Cesium.Math.toDegrees(viewer.camera.heading);
          if (
            Math.abs(nextHeading - headingRef.current) > HEADING_UPDATE_DEGREES
          ) {
            headingRef.current = nextHeading;
            setHeading(nextHeading);
          }
        }
      );

      // Mouse move → lat/lon under cursor
      screenSpaceHandler = new Cesium.ScreenSpaceEventHandler(
        viewer.scene.canvas
      );
      screenSpaceHandler.setInputAction(
        (movement: { endPosition: unknown }) => {
          const now = performance.now();
          if (now - lastCursorStatusUpdate < CURSOR_STATUS_UPDATE_MS) {
            return;
          }
          lastCursorStatusUpdate = now;

          const canvasPoint =
            movement.endPosition as import("cesium").Cartesian2;
          const pos =
            viewer.camera.pickEllipsoid(
              canvasPoint,
              viewer.scene.globe.ellipsoid
            ) ??
            (() => {
              const ray = viewer.camera.getPickRay(canvasPoint);
              return ray
                ? viewer.scene.globe.pick(ray, viewer.scene)
                : undefined;
            })();
          if (!pos) {
            if (cursorCoordsRef.current) {
              cursorCoordsRef.current = null;
              setCursorCoords(null);
            }
            return;
          }
          const carto = Cesium.Cartographic.fromCartesian(pos);
          const nextCoords = {
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude),
          };
          const previousCoords = cursorCoordsRef.current;
          const coordsChanged =
            !previousCoords ||
            Math.abs(nextCoords.lat - previousCoords.lat) >
              CURSOR_UPDATE_DEGREES ||
            Math.abs(nextCoords.lon - previousCoords.lon) >
              CURSOR_UPDATE_DEGREES;

          if (coordsChanged) {
            cursorCoordsRef.current = nextCoords;
            setCursorCoords(nextCoords);
          }
        },
        Cesium.ScreenSpaceEventType.MOUSE_MOVE
      );

      const coords = getAirportCoords(targetAirport, airportCoords);
      if (coords) {
        flyToAirportHome(viewer, Cesium, coords);
      } else {
        flyToDefaultHome(viewer, Cesium);
      }

      viewerRef.current = viewer;
      setViewerReadyKey((key) => key + 1);
      viewer.scene.requestRender();
    }

    init().catch(console.error);

    return () => {
      destroyed = true;
      el.removeEventListener("wheel", handleWheel, { capture: true });
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("gesturestart", onGestureStart, {
        capture: true,
      });
      el.removeEventListener("gesturechange", onGestureChange, {
        capture: true,
      });
      el.removeEventListener("gestureend", onGestureEnd, { capture: true });
      removeTileLoadListener?.();
      removePostRenderListener?.();
      if (screenSpaceHandler && !screenSpaceHandler.isDestroyed()) {
        screenSpaceHandler.destroy();
      }
      if (viewerRef.current) {
        try {
          (viewerRef.current as { destroy: () => void }).destroy();
        } catch {
          /* ignore */
        }
        viewerRef.current = null;
        baseLayerRef.current = null;
        overlayLayerRef.current = null;
        activeOverlayImageUrlRef.current = null;
        aircraftEntityRef.current = null;
        aircraftIconCanvasRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAirport]);

  // Render chart overlay whenever chartOverlay changes
  useEffect(() => {
    let cancelled = false;
    const Cesium = cesiumRef.current;
    const rawViewer = viewerRef.current as {
      camera: { flyTo: (opts: unknown) => void };
      scene: {
        primitives: {
          add: (primitive: unknown) => unknown;
          remove: (primitive: unknown) => boolean;
        };
        requestRender?: () => void;
      };
    } | null;

    if (!chartOverlay || !rawViewer || !Cesium) {
      if (overlayLayerRef.current && rawViewer) {
        rawViewer.scene.primitives.remove(overlayLayerRef.current);
        overlayLayerRef.current = null;
        activeOverlayImageUrlRef.current = null;
        rawViewer.scene.requestRender?.();
      }
      return;
    }

    const overlayKey = getChartOverlayKey(chartOverlay);
    if (
      overlayLayerRef.current &&
      activeOverlayImageUrlRef.current === overlayKey
    ) {
      return;
    }

    const rectangle = getChartOverlayRectangle(Cesium, chartOverlay);

    void loadOverlayImage(chartOverlay.imageUrl)
      .then((image) => {
        if (cancelled) return;

        const previousLayer = overlayLayerRef.current;
        const primitive = createChartOverlayPrimitive(
          Cesium,
          chartOverlay,
          image,
          chartOverlayAlphaRef.current
        );
        rawViewer.scene.primitives.add(primitive);
        overlayLayerRef.current = primitive;
        activeOverlayImageUrlRef.current = overlayKey;
        if (previousLayer) {
          rawViewer.scene.primitives.remove(previousLayer);
        }
        rawViewer.camera.flyTo({ destination: rectangle, duration: 0.75 });
        rawViewer.scene.requestRender?.();
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load chart overlay:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chartOverlay, viewerReadyKey]);

  useEffect(() => {
    chartOverlayAlphaRef.current = chartOverlayAlpha;

    const Cesium = cesiumRef.current;
    if (!overlayLayerRef.current || !Cesium) return;
    setChartOverlayPrimitiveAlpha(
      Cesium,
      overlayLayerRef.current,
      chartOverlayAlpha
    );

    const viewer = getGlobeViewer(viewerRef.current);
    viewer?.scene?.requestRender?.();
  }, [chartOverlayAlpha]);

  // Aircraft ownship marker — create once, mutate position/rotation/label on updates.
  // Never remove + re-add: that causes a one-frame gap (flicker).
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const rawViewer = viewerRef.current as {
      entities: {
        add: (entity: unknown) => unknown;
        remove: (entity: unknown) => boolean;
      };
      scene: { requestRender?: () => void };
    } | null;
    if (!Cesium || !rawViewer) return;

    if (!ownshipPosition) {
      if (aircraftEntityRef.current) {
        (aircraftEntityRef.current as { show: boolean }).show = false;
        rawViewer.scene.requestRender?.();
      }
      return;
    }

    const { lat, lon, altitudeFt, trackDeg } = ownshipPosition;
    const position = Cesium.Cartesian3.fromDegrees(
      lon,
      lat,
      AIRCRAFT_MARKER_HEIGHT_METERS
    );
    const rotationRad = getAircraftBillboardRotation(Cesium, trackDeg);
    const iconCanvas =
      aircraftIconCanvasRef.current ?? createOwnshipMarkerCanvas();
    aircraftIconCanvasRef.current = iconCanvas;

    const metaParts: string[] = [];
    if (altitudeFt !== null) metaParts.push(`${Math.round(altitudeFt)} ft`);
    if (ownshipPosition.groundSpeedKt !== null)
      metaParts.push(`${Math.round(ownshipPosition.groundSpeedKt)} kt`);
    if (trackDeg !== null)
      metaParts.push(
        `HDG ${Math.round(trackDeg).toString().padStart(3, "0")}°`
      );
    const labelText =
      metaParts.length > 0
        ? metaParts.join("  ·  ")
        : `${lat.toFixed(3)}°  ${lon.toFixed(3)}°`;

    // If the entity already exists, just update its mutable properties in place.
    if (aircraftEntityRef.current) {
      const e = aircraftEntityRef.current as {
        show: boolean;
        position: unknown;
        billboard: {
          alignedAxis: import("cesium").Cartesian3;
          image: HTMLCanvasElement;
          rotation: number;
        };
        label: { text: string };
      };
      e.show = true;
      e.position = new Cesium.ConstantPositionProperty(position);
      e.billboard.alignedAxis = Cesium.Cartesian3.UNIT_Z;
      e.billboard.image = iconCanvas;
      e.billboard.rotation = rotationRad;
      e.label.text = labelText;
      rawViewer.scene.requestRender?.();
      return;
    }

    const ICON_SIZE = 48;

    const entity = rawViewer.entities.add({
      position,
      billboard: {
        image: iconCanvas,
        width: ICON_SIZE,
        height: ICON_SIZE,
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        rotation: rotationRad,
        heightReference: Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      },
      label: {
        text: labelText,
        font: "bold 12px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, ICON_SIZE / 2 + 8),
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        heightReference: Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor:
          Cesium.Color.fromCssColorString("#1e3a5f").withAlpha(0.85),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    });

    aircraftEntityRef.current = entity;
    rawViewer.scene.requestRender?.();
  }, [ownshipPosition, viewerReadyKey]);

  const zoom = useCallback((inOut: "in" | "out") => {
    const viewer = getGlobeViewer(viewerRef.current);
    if (!viewer) return;
    zoomGlobeByDirection(viewer, inOut, 0.4, cesiumRef.current);
  }, []);

  const flyHome = useCallback(() => {
    const viewer = viewerRef.current as {
      camera: {
        flyTo: (opts: unknown) => void;
      };
      scene: { requestRender?: () => void };
    } | null;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    if (chartOverlay) {
      flyToChartOverlay(viewer, Cesium, chartOverlay);
      viewer.scene.requestRender?.();
      return;
    }

    const coords = getAirportCoords(targetAirport, airportCoords);
    if (coords) {
      flyToAirportHome(viewer, Cesium, coords);
    } else {
      flyToDefaultHome(viewer, Cesium);
    }
    viewer.scene.requestRender?.();
  }, [airportCoords, chartOverlay, targetAirport]);

  const centerAircraft = useCallback(() => {
    const viewer = viewerRef.current as {
      camera: {
        positionCartographic: { height: number };
        flyTo: (opts: unknown) => void;
      };
      scene: { requestRender?: () => void };
    } | null;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !ownshipPosition) return;

    flyToOwnship(viewer, Cesium, ownshipPosition);
    viewer.scene.requestRender?.();
  }, [ownshipPosition]);

  const resetNorth = useCallback(() => {
    const viewer = viewerRef.current as {
      camera: {
        flyTo: (opts: unknown) => void;
        positionCartographic: {
          longitude: number;
          latitude: number;
          height: number;
        };
        pitch: number;
        roll: number;
      };
      scene: { requestRender?: () => void };
    } | null;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    const { longitude, latitude, height } = viewer.camera.positionCartographic;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        longitude,
        latitude,
        clampCameraHeight(height)
      ),
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: viewer.camera.roll,
      },
      duration: 0.8,
    });
    viewer.scene.requestRender?.();
  }, []);

  const switchLayer = useCallback((layerId: string) => {
    const viewer = viewerRef.current as {
      imageryLayers: {
        add: (layer: unknown, index?: number) => void;
        remove: (layer: unknown, destroy?: boolean) => void;
      };
      scene: { requestRender?: () => void };
    } | null;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    const layer = LAYERS.find((l) => l.id === layerId);
    if (!layer) return;

    if (baseLayerRef.current) {
      viewer.imageryLayers.remove(baseLayerRef.current, true);
      baseLayerRef.current = null;
    }

    const nextBaseLayer = new Cesium.ImageryLayer(
      new Cesium.OpenStreetMapImageryProvider({
        url: layer.url,
        credit: "© OpenStreetMap contributors",
      })
    );
    viewer.imageryLayers.add(nextBaseLayer, 0);
    baseLayerRef.current = nextBaseLayer;
    setActiveLayer(layerId);
    setShowLayerPicker(false);
    viewer.scene.requestRender?.();
  }, []);

  return (
    <div className="absolute inset-0 z-30 bg-black">
      {/* Cesium canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {chartOverlayLoading && (
        <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm text-white shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Preparing chart</span>
        </div>
      )}

      {/* ── Top-right controls ── */}
      <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 items-end">
        {/* Close */}
        <button
          onClick={onClose}
          className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
          title="Close map"
          aria-label="Close map"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Tile loading pulse */}
        {tilesLoading && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-black/60 rounded-full text-xs text-white/70">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Loading
          </div>
        )}
      </div>

      {/* ── Compass (top-left) ── */}
      <button
        onClick={resetNorth}
        title="Reset north"
        aria-label="Reset north"
        className="absolute top-4 left-4 z-40 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors"
      >
        <svg
          viewBox="0 0 40 40"
          className="w-8 h-8"
          style={{
            transform: `rotate(${-heading}deg)`,
            transition: "transform 0.1s linear",
          }}
        >
          {/* N needle – red */}
          <polygon points="20,4 16,20 20,18 24,20" fill="#ef4444" />
          {/* S needle – white */}
          <polygon points="20,36 16,20 20,22 24,20" fill="#ffffff80" />
          {/* Center dot */}
          <circle cx="20" cy="20" r="2" fill="white" />
        </svg>
      </button>

      {/* ── Right-side zoom + layer controls ── */}
      <div className="absolute right-4 bottom-12 z-40 flex flex-col gap-2 items-center">
        {/* Layer picker */}
        <div className="relative">
          {showLayerPicker && (
            <div className="absolute bottom-full mb-2 right-0 bg-black/80 rounded-lg overflow-hidden border border-white/10 text-xs text-white">
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => switchLayer(l.id)}
                  className={`block w-full text-left px-3 py-2 hover:bg-white/10 transition-colors ${
                    activeLayer === l.id ? "text-blue-400 font-bold" : ""
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowLayerPicker((v) => !v)}
            className="w-9 h-9 bg-black/60 hover:bg-black/80 text-white rounded-lg flex items-center justify-center transition-colors"
            title="Switch map layer"
            aria-label="Switch map layer"
          >
            <Layers className="w-4 h-4" />
          </button>
        </div>

        {chartOverlay && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-black/60 text-white rounded-lg border border-white/10">
            <SlidersHorizontal className="w-4 h-4 text-white/80" />
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(chartOverlayAlpha * 100)}
              onChange={(event) =>
                setChartOverlayAlpha(Number(event.target.value) / 100)
              }
              className="w-24 accent-blue-400"
              aria-label="Chart opacity"
              title="Chart opacity"
            />
            <span className="w-8 text-right text-[10px] tabular-nums text-white/80">
              {Math.round(chartOverlayAlpha * 100)}%
            </span>
          </div>
        )}

        {/* Home */}
        <button
          onClick={flyHome}
          className="w-9 h-9 bg-black/60 hover:bg-black/80 text-white rounded-lg flex items-center justify-center transition-colors"
          title="Fly home"
          aria-label="Fly home"
        >
          <Home className="w-4 h-4" />
        </button>

        {ownshipPosition && (
          <button
            onClick={centerAircraft}
            className="w-9 h-9 bg-black/60 hover:bg-black/80 text-blue-400 rounded-lg flex items-center justify-center transition-colors"
            title="Center aircraft"
            aria-label="Center aircraft"
          >
            <Navigation className="w-4 h-4" />
          </button>
        )}

        {/* Zoom in */}
        <button
          onClick={() => zoom("in")}
          className="w-9 h-9 bg-black/60 hover:bg-black/80 text-white rounded-t-lg flex items-center justify-center transition-colors border-b border-white/10"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Zoom out */}
        <button
          onClick={() => zoom("out")}
          className="w-9 h-9 bg-black/60 hover:bg-black/80 text-white rounded-b-lg flex items-center justify-center transition-colors"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* ── Bottom status bar ── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex gap-3 items-center px-3 py-1.5 bg-black/60 rounded-full text-xs text-white/80 pointer-events-none select-none">
        {/* Ownship ADS-B indicator */}
        {ownshipPosition && (
          <>
            <span
              className="flex items-center gap-1 text-blue-400 font-semibold"
              title="ADS-B ownship position"
            >
              <Navigation className="w-3 h-3" />
              {ownshipPosition.lat.toFixed(4)}° {ownshipPosition.lon.toFixed(4)}
              °
              {ownshipPosition.altitudeFt !== null &&
                ` · ${Math.round(ownshipPosition.altitudeFt)} ft`}
              {ownshipPosition.groundSpeedKt !== null &&
                ` · ${Math.round(ownshipPosition.groundSpeedKt)} kt`}
              {ownshipPosition.trackDeg !== null &&
                ` · HDG ${Math.round(ownshipPosition.trackDeg).toString().padStart(3, "0")}°`}
            </span>
            <span className="opacity-40">|</span>
          </>
        )}
        {/* Altitude */}
        {altitude !== null && (
          <span title="Camera altitude">↕ {formatAltitude(altitude)}</span>
        )}
        {/* Cursor coords */}
        {cursorCoords && (
          <>
            <span className="opacity-40">|</span>
            <span>{formatDeg(cursorCoords.lat, "N", "S")}</span>
            <span>{formatDeg(cursorCoords.lon, "E", "W")}</span>
          </>
        )}
      </div>
    </div>
  );
}
