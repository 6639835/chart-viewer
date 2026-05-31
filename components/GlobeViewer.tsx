"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Home, Layers, Minus, Plus, X } from "lucide-react";

interface GlobeViewerProps {
  onClose: () => void;
  targetAirport?: string;
}

const AIRPORT_COORDS: Record<string, [number, number]> = {
  ZBAA: [116.6, 40.08],
  ZGSZ: [113.82, 22.64],
  ZSSS: [121.34, 31.2],
  ZGGG: [113.3, 23.39],
  ZUUU: [103.95, 30.58],
  ZPPP: [102.93, 25.1],
  ZUCK: [106.64, 29.72],
  ZLXY: [108.75, 34.45],
  ZHHH: [114.21, 30.78],
  ZGHA: [113.22, 28.19],
  ZSAM: [118.13, 24.54],
  ZJHK: [110.46, 19.93],
  ZLIC: [87.47, 43.91],
  ZLLL: [103.63, 36.52],
  ZWWW: [87.47, 43.91],
};

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
    positionCartographic: { height: number };
    positionWC: import("cesium").Cartesian3;
    getPickRay: (
      windowPosition: import("cesium").Cartesian2
    ) => import("cesium").Ray | undefined;
    move: (direction: import("cesium").Cartesian3, amount?: number) => void;
    zoomIn: (amount?: number) => void;
    zoomOut: (amount?: number) => void;
    moveLeft: (amount?: number) => void;
    moveRight: (amount?: number) => void;
    moveUp: (amount?: number) => void;
    moveDown: (amount?: number) => void;
  };
  scene?: {
    canvas: HTMLCanvasElement;
    globe: {
      pick: (
        ray: import("cesium").Ray,
        scene: unknown
      ) => import("cesium").Cartesian3 | undefined;
    };
    requestRender?: () => void;
  };
};

const WHEEL_PINCH_ZOOM_SENSITIVITY = 0.006;
const WHEEL_PAN_SENSITIVITY = 0.0012;
const MIN_CAMERA_HEIGHT_METERS = 250;
const MAX_CAMERA_HEIGHT_METERS = 25_000_000;
const AIRPORT_HOME_HEIGHT_METERS = 20_000;

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

function getAirportCoords(targetAirport?: string) {
  return targetAirport ? (AIRPORT_COORDS[targetAirport] ?? null) : null;
}

function flyToAirportHome(
  viewer: {
    camera: {
      flyTo: (options: {
        destination: import("cesium").Cartesian3;
        orientation: { heading: number; pitch: number; roll: number };
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
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
    duration,
  });
}

function flyToDefaultHome(
  viewer: {
    camera: {
      flyTo: (options: {
        destination: import("cesium").Cartesian3;
        orientation: { heading: number; pitch: number; roll: number };
        duration?: number;
      }) => void;
    };
  },
  Cesium: typeof import("cesium"),
  duration = 0
) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(105, 35, 12_000_000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0,
    },
    duration,
  });
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

  const anchored = zoomGlobeAtClientPoint(
    viewer,
    direction,
    amount,
    Cesium,
    clientPoint
  );
  if (!anchored) {
    if (direction === "in") {
      viewer.camera.zoomIn(amount);
    } else {
      viewer.camera.zoomOut(amount);
    }
  }

  viewer.scene?.requestRender?.();
}

function zoomGlobeAtClientPoint(
  viewer: GlobeViewerInstance,
  direction: "in" | "out",
  amount: number,
  Cesium?: typeof import("cesium") | null,
  clientPoint?: ClientPoint | null
) {
  if (!Cesium || !clientPoint || !viewer.scene) {
    return false;
  }

  const canvasRect = viewer.scene.canvas.getBoundingClientRect();
  const canvasPoint = new Cesium.Cartesian2(
    clientPoint.clientX - canvasRect.left,
    clientPoint.clientY - canvasRect.top
  );
  const ray = viewer.camera.getPickRay(canvasPoint);
  if (!ray) {
    return false;
  }

  const target = viewer.scene.globe.pick(ray, viewer.scene);
  if (!target) {
    return false;
  }

  const moveDirection = Cesium.Cartesian3.subtract(
    target,
    viewer.camera.positionWC,
    new Cesium.Cartesian3()
  );

  if (Cesium.Cartesian3.magnitude(moveDirection) <= 0) {
    return false;
  }

  Cesium.Cartesian3.normalize(moveDirection, moveDirection);
  if (direction === "out") {
    Cesium.Cartesian3.negate(moveDirection, moveDirection);
  }

  viewer.camera.move(moveDirection, amount);
  return true;
}

function panGlobeByWheel(viewer: GlobeViewerInstance, event: WheelEvent) {
  const panScale =
    clampCameraHeight(getCameraHeight(viewer)) * WHEEL_PAN_SENSITIVITY;
  const horizontal = clamp(event.deltaX, -120, 120) * panScale;
  const vertical = clamp(event.deltaY, -120, 120) * panScale;

  if (horizontal > 0) viewer.camera.moveRight(Math.abs(horizontal));
  if (horizontal < 0) viewer.camera.moveLeft(Math.abs(horizontal));
  if (vertical > 0) viewer.camera.moveDown(Math.abs(vertical));
  if (vertical < 0) viewer.camera.moveUp(Math.abs(vertical));

  viewer.scene?.requestRender?.();
}

export default function GlobeViewer({
  onClose,
  targetAirport,
}: GlobeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Store the full Cesium Viewer type at runtime but keep TS happy with unknown
  const viewerRef = useRef<unknown>(null);
  const cesiumRef = useRef<typeof import("cesium") | null>(null);

  const [altitude, setAltitude] = useState<number | null>(null);
  const [heading, setHeading] = useState(0); // degrees, for compass needle
  const [cursorCoords, setCursorCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [activeLayer, setActiveLayer] = useState("osm");
  const [showLayerPicker, setShowLayerPicker] = useState(false);

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

      panGlobeByWheel(viewer, event);
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
      const Cesium = await import("cesium");
      if (destroyed || !containerRef.current) return;

      cesiumRef.current = Cesium;

      const layer = LAYERS.find((l) => l.id === activeLayer) ?? LAYERS[0];
      const osmProvider = new Cesium.OpenStreetMapImageryProvider({
        url: layer.url,
        credit: "© OpenStreetMap contributors",
      });

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer: new Cesium.ImageryLayer(osmProvider),
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
      });

      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0a14");

      // Apple Maps-style input: pinch gesture = cursor-anchored zoom, scroll = pan.
      // Disable Cesium's built-in wheel/pinch zoom so it cannot center-zoom first.
      const ctrl = viewer.scene.screenSpaceCameraController;
      ctrl.inertiaZoom = 0;
      ctrl.minimumZoomDistance = MIN_CAMERA_HEIGHT_METERS;
      ctrl.maximumZoomDistance = MAX_CAMERA_HEIGHT_METERS;
      ctrl.zoomEventTypes = [Cesium.CameraEventType.RIGHT_DRAG];

      viewerRef.current = viewer;

      // Tile loading indicator
      viewer.scene.globe.tileLoadProgressEvent.addEventListener(
        (remaining: number) => {
          setTilesLoading(remaining > 0);
        }
      );

      // Per-frame: update altitude, heading, cursor coords
      viewer.scene.postRender.addEventListener(() => {
        const cart = viewer.camera.positionCartographic;
        if (cart) {
          setAltitude(cart.height);
          setHeading(Cesium.Math.toDegrees(viewer.camera.heading));
        }
      });

      // Mouse move → lat/lon under cursor
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: { endPosition: unknown }) => {
        const ray = viewer.camera.getPickRay(
          movement.endPosition as import("cesium").Cartesian2
        );
        if (!ray) return;
        const pos = viewer.scene.globe.pick(ray, viewer.scene);
        if (!pos) {
          setCursorCoords(null);
          return;
        }
        const carto = Cesium.Cartographic.fromCartesian(pos);
        setCursorCoords({
          lat: Cesium.Math.toDegrees(carto.latitude),
          lon: Cesium.Math.toDegrees(carto.longitude),
        });
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      const coords = getAirportCoords(targetAirport);
      if (coords) {
        flyToAirportHome(viewer, Cesium, coords);
      } else {
        flyToDefaultHome(viewer, Cesium);
      }

      viewerRef.current = viewer;
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
      if (viewerRef.current) {
        try {
          (viewerRef.current as { destroy: () => void }).destroy();
        } catch {
          /* ignore */
        }
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAirport]);

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
    } | null;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    const coords = getAirportCoords(targetAirport);
    if (coords) {
      flyToAirportHome(viewer, Cesium, coords);
    } else {
      flyToDefaultHome(viewer, Cesium);
    }
  }, [targetAirport]);

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
  }, []);

  const switchLayer = useCallback((layerId: string) => {
    const viewer = viewerRef.current as {
      imageryLayers: {
        removeAll: () => void;
        addImageryProvider: (p: unknown) => void;
      };
    } | null;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    const layer = LAYERS.find((l) => l.id === layerId);
    if (!layer) return;

    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({
        url: layer.url,
        credit: "© OpenStreetMap contributors",
      })
    );
    setActiveLayer(layerId);
    setShowLayerPicker(false);
  }, []);

  return (
    <div className="absolute inset-0 z-30 bg-black">
      {/* Cesium canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Top-right controls ── */}
      <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 items-end">
        {/* Close */}
        <button
          onClick={onClose}
          className="p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors"
          title="Close globe"
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
          >
            <Layers className="w-4 h-4" />
          </button>
        </div>

        {/* Home */}
        <button
          onClick={flyHome}
          className="w-9 h-9 bg-black/60 hover:bg-black/80 text-white rounded-lg flex items-center justify-center transition-colors"
          title="Fly home"
        >
          <Home className="w-4 h-4" />
        </button>

        {/* Zoom in */}
        <button
          onClick={() => zoom("in")}
          className="w-9 h-9 bg-black/60 hover:bg-black/80 text-white rounded-t-lg flex items-center justify-center transition-colors border-b border-white/10"
          title="Zoom in"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Zoom out */}
        <button
          onClick={() => zoom("out")}
          className="w-9 h-9 bg-black/60 hover:bg-black/80 text-white rounded-b-lg flex items-center justify-center transition-colors"
          title="Zoom out"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {/* ── Bottom status bar ── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex gap-3 items-center px-3 py-1.5 bg-black/60 rounded-full text-xs text-white/80 pointer-events-none select-none">
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
