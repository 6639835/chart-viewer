"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as pdfjs from "pdfjs-dist";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Menu,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useI18n } from "@/components/I18nProvider";
import { getFormattedChartName } from "@/lib/chartFormatter";
import { useAutoHideScrollbar } from "@/lib/hooks/useAutoHideScrollbar";
import { ChartData, isGeoreferenceable } from "@/types/chart";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PDFViewerProps {
  pdfUrl: string;
  chart: ChartData;
  onOpenSidebar?: () => void;
  bookmarkedCharts: ChartData[];
  onNavigateToBookmark: (direction: "next" | "prev") => void;
  onShowOnMap?: (pageNumber: number) => void;
  georefLoading?: boolean;
  getPageImageRef?: MutableRefObject<
    ((pageNumber: number) => Promise<string | null>) | null
  >;
}

interface PageSize {
  width: number;
  height: number;
}

interface ZoomAnchor {
  clientX: number;
  clientY: number;
  ratioX: number;
  ratioY: number;
}

const MANUAL_PAGE_PADDING = 8;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.2;
const WHEEL_ZOOM_STEP = 0.05;
const RENDER_SETTLE_DELAY_MS = 140;
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const MAX_CANVAS_PIXELS = 12_000_000;
const GLOBE_OVERLAY_MAX_LONG_EDGE = 4096;
const GLOBE_OVERLAY_MAX_CANVAS_PIXELS = 10_000_000;
const GLOBE_OVERLAY_IMAGE_TYPE = "image/jpeg";
const GLOBE_OVERLAY_IMAGE_QUALITY = 0.84;
const PDF_RANGE_CHUNK_SIZE = 512 * 1024;
const PDF_INITIAL_CHUNK_SIZE = 256 * 1024;
const MAX_FULL_PDF_FALLBACK_BYTES = 32 * 1024 * 1024;
const PDF_IMAGE_DECODE_MAX_BYTES = 48 * 1024 * 1024;
const PDF_HEADER = "%PDF";
const PAGE_CACHE_RADIUS = 0;
const LINE_WHEEL_SCROLL_PIXELS = 40;
const PAGE_WHEEL_SCROLL_PIXELS = 320;

let cachedMaxTextureSize: number | null = null;

interface PdfRangeResponse {
  data: Uint8Array;
  totalLength: number | null;
  isPartial: boolean;
}

class FetchPdfRangeTransport extends pdfjs.PDFDataRangeTransport {
  private readonly controllers = new Set<AbortController>();

  constructor(
    private readonly pdfUrl: string,
    length: number,
    initialData: Uint8Array,
    private readonly onRangeError: (error: unknown) => void
  ) {
    super(length, initialData);
  }

  requestDataRange(begin: number, end: number) {
    const controller = new AbortController();
    this.controllers.add(controller);

    void fetchPdfByteRange(this.pdfUrl, begin, end, controller.signal)
      .then(({ data }) => {
        this.controllers.delete(controller);
        this.onDataRange(begin, data);
      })
      .catch((error) => {
        this.controllers.delete(controller);
        if (!controller.signal.aborted) {
          console.error("PDF range request failed:", error);
          this.onRangeError(error);
        }
      });
  }

  abort() {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function shouldWheelZoom(event: WheelEvent, isWindows: boolean) {
  // Trackpad pinch gestures typically surface as ctrl/meta + wheel. Keep supporting that.
  if (event.ctrlKey || event.metaKey) return true;

  // On Windows, users expect the mouse wheel to zoom the chart.
  if (isWindows) return true;

  // Heuristic: mouse wheels often use line/page deltas, trackpads use pixel deltas.
  return event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL;
}

function getWheelPanDelta(event: WheelEvent) {
  const multiplier =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_WHEEL_SCROLL_PIXELS
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? PAGE_WHEEL_SCROLL_PIXELS
        : 1;

  const deltaX = event.deltaX * multiplier;
  const deltaY = event.deltaY * multiplier;

  if (event.shiftKey && deltaX === 0) {
    return { left: deltaY, top: 0 };
  }

  return { left: deltaX, top: deltaY };
}

function getCanvasPixelRatio(
  pageSize: PageSize,
  scale: number,
  devicePixelRatio: number
) {
  const pagePixels = pageSize.width * scale * pageSize.height * scale;
  if (pagePixels <= 0) {
    return 1;
  }

  const maxRatioForPage = Math.sqrt(MAX_CANVAS_PIXELS / pagePixels);

  return Math.max(
    Math.min(devicePixelRatio, MAX_DEVICE_PIXEL_RATIO, maxRatioForPage),
    0.1
  );
}

function getBrowserMaxTextureSize() {
  if (cachedMaxTextureSize !== null) {
    return cachedMaxTextureSize;
  }

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const maxTextureSize =
    gl?.getParameter(gl.MAX_TEXTURE_SIZE) ?? GLOBE_OVERLAY_MAX_LONG_EDGE;
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  canvas.width = 0;
  canvas.height = 0;

  cachedMaxTextureSize = Math.max(
    4096,
    Math.min(maxTextureSize, GLOBE_OVERLAY_MAX_LONG_EDGE)
  );
  return cachedMaxTextureSize;
}

function getGlobeOverlayScale(pageSize: PageSize) {
  const pagePixels = pageSize.width * pageSize.height;
  if (pagePixels <= 0) return 1;

  const maxLongEdge = getBrowserMaxTextureSize();
  const longEdgeScale = maxLongEdge / Math.max(pageSize.width, pageSize.height);
  const pixelBudgetScale = Math.sqrt(
    GLOBE_OVERLAY_MAX_CANVAS_PIXELS / pagePixels
  );

  return Math.max(0.1, Math.min(longEdgeScale, pixelBudgetScale));
}

function canvasToBlobUrl(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number
) {
  return new Promise<string | null>((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob ? URL.createObjectURL(blob) : null);
      },
      type,
      quality
    );
  });
}

function releaseCanvasBackingStore(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = "";
  canvas.style.height = "";
}

function isPdfRenderCancellation(error: unknown) {
  return error instanceof pdfjs.RenderingCancelledException;
}

function getAsciiPrefix(bytes: Uint8Array, length: number) {
  return Array.from(bytes.slice(0, length))
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

function validatePdfHeader(data: Uint8Array, pdfUrl: string) {
  const header = getAsciiPrefix(data, PDF_HEADER.length);

  if (header !== PDF_HEADER) {
    throw new Error(
      `Invalid PDF response for ${pdfUrl}: expected ${PDF_HEADER}, got ${JSON.stringify(
        header
      )}`
    );
  }
}

function parseContentLength(headers: Headers) {
  const contentLength = Number(headers.get("Content-Length"));
  return Number.isFinite(contentLength) && contentLength >= 0
    ? contentLength
    : null;
}

function parseContentRangeLength(headers: Headers) {
  const contentRange = headers.get("Content-Range");
  const totalMatch = contentRange?.match(/\/(\d+)$/);
  if (!totalMatch) return null;

  const totalLength = Number(totalMatch[1]);
  return Number.isFinite(totalLength) && totalLength >= 0 ? totalLength : null;
}

async function fetchPdfByteRange(
  pdfUrl: string,
  begin: number,
  end: number,
  signal: AbortSignal
): Promise<PdfRangeResponse> {
  const lastByte = Math.max(begin, end - 1);
  const response = await fetch(pdfUrl, {
    headers: {
      Range: `bytes=${begin}-${lastByte}`,
    },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to load PDF: ${response.status} ${response.statusText}` +
        (body ? ` - ${body.slice(0, 120)}` : "")
    );
  }

  const data = new Uint8Array(await response.arrayBuffer());
  const isPartial = response.status === 206;
  const totalLength =
    parseContentRangeLength(response.headers) ??
    (isPartial ? null : parseContentLength(response.headers)) ??
    data.byteLength;

  return {
    data,
    totalLength,
    isPartial,
  };
}

async function fetchPdfData(
  pdfUrl: string,
  signal: AbortSignal
): Promise<Uint8Array> {
  const response = await fetch(pdfUrl, { signal });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to load PDF: ${response.status} ${response.statusText}` +
        (body ? ` - ${body.slice(0, 120)}` : "")
    );
  }

  const data = new Uint8Array(await response.arrayBuffer());
  validatePdfHeader(data, pdfUrl);
  return data;
}

function createFullPdfLoadingTask(data: Uint8Array) {
  return {
    loadingTask: pdfjs.getDocument({
      data,
      enableHWA: true,
      useWasm: true,
      canvasMaxAreaInBytes: PDF_IMAGE_DECODE_MAX_BYTES,
    }),
    rangeTransport: null,
  };
}

async function createPdfLoadingTask(
  pdfUrl: string,
  signal: AbortSignal,
  onRangeError: (error: unknown) => void
) {
  let initialRange: PdfRangeResponse;

  try {
    initialRange = await fetchPdfByteRange(
      pdfUrl,
      0,
      PDF_INITIAL_CHUNK_SIZE,
      signal
    );
  } catch (error) {
    if (signal.aborted || !(error instanceof TypeError)) {
      throw error;
    }

    return createFullPdfLoadingTask(await fetchPdfData(pdfUrl, signal));
  }

  const { data, totalLength, isPartial } = initialRange;
  validatePdfHeader(data, pdfUrl);

  if (isPartial && totalLength === null) {
    return createFullPdfLoadingTask(await fetchPdfData(pdfUrl, signal));
  }

  const knownTotalLength = totalLength ?? data.byteLength;

  if (!isPartial || knownTotalLength <= data.byteLength) {
    if (data.byteLength > MAX_FULL_PDF_FALLBACK_BYTES) {
      throw new Error(
        `PDF server did not provide range data for a ${Math.round(
          data.byteLength / (1024 * 1024)
        )} MB file.`
      );
    }

    return createFullPdfLoadingTask(data);
  }

  const rangeTransport = new FetchPdfRangeTransport(
    pdfUrl,
    knownTotalLength,
    data,
    onRangeError
  );

  return {
    loadingTask: pdfjs.getDocument({
      range: rangeTransport,
      rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
      disableAutoFetch: true,
      disableStream: true,
      enableHWA: true,
      useWasm: true,
      canvasMaxAreaInBytes: PDF_IMAGE_DECODE_MAX_BYTES,
    }),
    rangeTransport,
  };
}

export default function PDFViewer({
  pdfUrl,
  chart,
  onOpenSidebar,
  bookmarkedCharts,
  onNavigateToBookmark,
  onShowOnMap,
  georefLoading,
  getPageImageRef,
}: PDFViewerProps) {
  const { t, tChartType } = useI18n();
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize | null>(null);
  const [containerSize, setContainerSize] = useState<PageSize>({
    width: 0,
    height: 0,
  });
  const [devicePixelRatio, setDevicePixelRatio] = useState(1);
  const [targetScale, setTargetScale] = useState(1);
  const [renderScale, setRenderScale] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(true);
  const [pageRendering, setPageRendering] = useState(false);
  const [errorKey, setErrorKey] = useState<
    "pdf.failedToLoad" | "pdf.failedToRender" | null
  >(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rotation, setRotation] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const rangeTransportRef = useRef<FetchPdfRangeTransport | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const overlayRenderTaskRef = useRef<RenderTask | null>(null);
  const pageCacheRef = useRef<Map<number, PDFPageProxy>>(new Map());
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null);
  const renderIdRef = useRef(0);
  const scaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const scrollStartRef = useRef({ left: 0, top: 0 });
  const latestPageNumberRef = useRef(1);

  const { theme } = useTheme();
  const isScrolling = useAutoHideScrollbar(containerRef, {
    enabled: !autoFit,
  });

  const invertColors = theme === "dark";
  const autoFitScale = useMemo(() => {
    if (!pageSize || containerSize.width <= 0 || containerSize.height <= 0) {
      return 1;
    }

    return Math.min(
      containerSize.width / pageSize.width,
      containerSize.height / pageSize.height
    );
  }, [containerSize.height, containerSize.width, pageSize]);

  const visibleScale = autoFit ? autoFitScale : targetScale;
  const displayWidth = pageSize ? pageSize.width * visibleScale : 0;
  const displayHeight = pageSize ? pageSize.height * visibleScale : 0;
  const manualPageOuterWidth = displayWidth + MANUAL_PAGE_PADDING * 2;
  const manualPageOuterHeight = displayHeight + MANUAL_PAGE_PADDING * 2;
  const manualStageWidth = Math.max(manualPageOuterWidth, containerSize.width);
  const manualStageHeight = Math.max(
    manualPageOuterHeight,
    containerSize.height
  );
  const centerManualPageHorizontally =
    !autoFit && displayWidth > 0 && manualPageOuterWidth < containerSize.width;
  const centerManualPageVertically =
    !autoFit &&
    displayHeight > 0 &&
    manualPageOuterHeight < containerSize.height;
  const loading = documentLoading || pageRendering;

  const captureZoomAnchor = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      zoomAnchorRef.current = null;
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      zoomAnchorRef.current = null;
      return;
    }

    const containerRect = container.getBoundingClientRect();

    zoomAnchorRef.current = {
      clientX: clientX - containerRect.left,
      clientY: clientY - containerRect.top,
      ratioX: clamp((clientX - canvasRect.left) / canvasRect.width, 0, 1),
      ratioY: clamp((clientY - canvasRect.top) / canvasRect.height, 0, 1),
    };
  }, []);

  const captureViewportCenterZoomAnchor = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    captureZoomAnchor(
      containerRect.left + containerRect.width / 2,
      containerRect.top + containerRect.height / 2
    );
  }, [captureZoomAnchor]);

  const clearPageCache = useCallback(() => {
    for (const page of pageCacheRef.current.values()) {
      page.cleanup();
    }
    pageCacheRef.current.clear();
  }, []);

  const cancelRender = useCallback(() => {
    renderIdRef.current += 1;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
  }, []);

  const scheduleRenderScale = useCallback((nextScale: number) => {
    if (scaleTimerRef.current) {
      clearTimeout(scaleTimerRef.current);
    }

    scaleTimerRef.current = setTimeout(() => {
      setRenderScale(nextScale);
    }, RENDER_SETTLE_DELAY_MS);
  }, []);

  const getPage = useCallback(
    async (page: number) => {
      if (!pdfDocument) {
        return null;
      }

      const cachedPage = pageCacheRef.current.get(page);
      if (cachedPage) {
        return cachedPage;
      }

      const loadedPage = await pdfDocument.getPage(page);
      pageCacheRef.current.set(page, loadedPage);
      return loadedPage;
    },
    [pdfDocument]
  );

  const trimPageCache = useCallback((centerPage: number) => {
    for (const [pageNumber, page] of pageCacheRef.current.entries()) {
      if (Math.abs(pageNumber - centerPage) > PAGE_CACHE_RADIUS) {
        page.cleanup();
        pageCacheRef.current.delete(pageNumber);
      }
    }
  }, []);

  const preloadAdjacentPages = useCallback(
    (centerPage: number) => {
      if (!pdfDocument) return;
      const documentForPreload = pdfDocument;

      for (
        let page = Math.max(1, centerPage - PAGE_CACHE_RADIUS);
        page <= Math.min(pdfDocument.numPages, centerPage + PAGE_CACHE_RADIUS);
        page += 1
      ) {
        if (page !== centerPage && !pageCacheRef.current.has(page)) {
          void pdfDocument
            .getPage(page)
            .then((loadedPage) => {
              const isStaleDocument =
                pdfDocumentRef.current !== documentForPreload;
              const isOutsideCurrentRadius =
                Math.abs(page - latestPageNumberRef.current) >
                PAGE_CACHE_RADIUS;

              if (
                isStaleDocument ||
                isOutsideCurrentRadius ||
                pageCacheRef.current.has(page)
              ) {
                loadedPage.cleanup();
                return;
              }

              pageCacheRef.current.set(page, loadedPage);
            })
            .catch(() => {
              // Preload failures should not interrupt the visible page.
            });
        }
      }
    },
    [pdfDocument]
  );

  useEffect(() => {
    if (!getPageImageRef) return;

    getPageImageRef.current = async (requestedPageNumber: number) => {
      const page = await getPage(requestedPageNumber);
      if (!page) return null;

      const baseViewport = page.getViewport({ scale: 1, rotation: 0 });
      const overlayScale = getGlobeOverlayScale({
        width: baseViewport.width,
        height: baseViewport.height,
      });
      const viewport = page.getViewport({ scale: overlayScale, rotation: 0 });
      const canvas = document.createElement("canvas");
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });

      if (!context || width <= 0 || height <= 0) {
        return null;
      }

      canvas.width = width;
      canvas.height = height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);

      overlayRenderTaskRef.current?.cancel();
      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: "rgb(255,255,255)",
        annotationMode: pdfjs.AnnotationMode.DISABLE,
      });
      overlayRenderTaskRef.current = renderTask;

      try {
        await renderTask.promise;
        return await canvasToBlobUrl(
          canvas,
          GLOBE_OVERLAY_IMAGE_TYPE,
          GLOBE_OVERLAY_IMAGE_QUALITY
        );
      } catch (error) {
        if (isPdfRenderCancellation(error)) {
          return null;
        }
        throw error;
      } finally {
        if (overlayRenderTaskRef.current === renderTask) {
          overlayRenderTaskRef.current = null;
        }
        releaseCanvasBackingStore(canvas);
      }
    };

    return () => {
      if (getPageImageRef) {
        getPageImageRef.current = null;
      }
    };
  }, [getPage, getPageImageRef]);

  useEffect(() => {
    const updateDevicePixelRatio = () => {
      setDevicePixelRatio(window.devicePixelRatio || 1);
    };

    updateDevicePixelRatio();
    window.addEventListener("resize", updateDevicePixelRatio);

    return () => window.removeEventListener("resize", updateDevicePixelRatio);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateContainerSize = () => {
      const container = containerRef.current;
      if (!container) return;

      const padding = window.innerWidth < 640 ? 16 : 32;
      const nextSize = {
        width: Math.max(container.clientWidth - padding, 0),
        height: Math.max(container.clientHeight - padding, 0),
      };

      setContainerSize((previousSize) =>
        previousSize.width === nextSize.width &&
        previousSize.height === nextSize.height
          ? previousSize
          : nextSize
      );
    };

    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (scaleTimerRef.current) {
      clearTimeout(scaleTimerRef.current);
    }

    if (autoFit) {
      setTargetScale(autoFitScale);
      scheduleRenderScale(autoFitScale);
    }
  }, [autoFit, autoFitScale, scheduleRenderScale]);

  useEffect(() => {
    latestPageNumberRef.current = pageNumber;
  }, [pageNumber]);

  useLayoutEffect(() => {
    const zoomAnchor = zoomAnchorRef.current;
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!zoomAnchor || !container || !canvas || autoFit) {
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      zoomAnchorRef.current = null;
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const canvasContentLeft =
      canvasRect.left - containerRect.left + container.scrollLeft;
    const canvasContentTop =
      canvasRect.top - containerRect.top + container.scrollTop;

    container.scrollLeft =
      canvasContentLeft +
      canvasRect.width * zoomAnchor.ratioX -
      zoomAnchor.clientX;
    container.scrollTop =
      canvasContentTop +
      canvasRect.height * zoomAnchor.ratioY -
      zoomAnchor.clientY;
    zoomAnchorRef.current = null;
  }, [autoFit, displayHeight, displayWidth]);

  useEffect(() => {
    let cancelled = false;
    const pdfAbortController = new AbortController();
    const canvas = canvasRef.current;

    setPdfDocument(null);
    pdfDocumentRef.current = null;
    setNumPages(0);
    setPageNumber(1);
    setPageSize(null);
    setTargetScale(1);
    setRenderScale(1);
    setDocumentLoading(true);
    setPageRendering(false);
    setErrorKey(null);
    setRotation(0);
    cancelRender();
    overlayRenderTaskRef.current?.cancel();
    overlayRenderTaskRef.current = null;
    clearPageCache();
    releaseCanvasBackingStore(canvas);

    if (loadingTaskRef.current) {
      void loadingTaskRef.current.destroy();
      loadingTaskRef.current = null;
    }
    rangeTransportRef.current?.abort();
    rangeTransportRef.current = null;

    const handleRangeError = (error: unknown) => {
      if (cancelled) return;

      console.error("PDF range load error:", {
        error,
        chartId: chart.ChartId,
        chartName: chart.ChartName,
        pdfUrl,
      });
      setErrorKey("pdf.failedToLoad");
      setDocumentLoading(false);
      setPageRendering(false);
      cancelRender();
      rangeTransportRef.current?.abort();
      if (loadingTaskRef.current) {
        const loadingTask = loadingTaskRef.current;
        loadingTaskRef.current = null;
        void loadingTask.destroy();
      }
    };

    const loadDocument = async () => {
      const { loadingTask, rangeTransport } = await createPdfLoadingTask(
        pdfUrl,
        pdfAbortController.signal,
        handleRangeError
      );

      if (cancelled) {
        rangeTransport?.abort();
        void loadingTask.destroy();
        return;
      }

      loadingTaskRef.current = loadingTask;
      rangeTransportRef.current = rangeTransport;
      const document = await loadingTask.promise;

      if (cancelled) {
        void document.destroy();
        return;
      }

      return document;
    };

    void loadDocument()
      .then((document) => {
        if (!document) return;

        if (cancelled) {
          void document.destroy();
          return;
        }

        pdfDocumentRef.current = document;
        setPdfDocument(document);
        setNumPages(document.numPages);
        setDocumentLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) return;

        console.error("PDF load error:", {
          error: loadError,
          chartId: chart.ChartId,
          chartName: chart.ChartName,
          chartType: chart.ChartTypeEx_CH,
          pageNumber: chart.PAGE_NUMBER,
          pdfUrl,
        });
        setErrorKey("pdf.failedToLoad");
        setDocumentLoading(false);
      });

    return () => {
      cancelled = true;
      pdfAbortController.abort();
      cancelRender();
      overlayRenderTaskRef.current?.cancel();
      overlayRenderTaskRef.current = null;
      clearPageCache();
      releaseCanvasBackingStore(canvas);
      pdfDocumentRef.current = null;
      setPdfDocument(null);

      rangeTransportRef.current?.abort();
      rangeTransportRef.current = null;

      if (loadingTaskRef.current) {
        const loadingTask = loadingTaskRef.current;
        loadingTaskRef.current = null;
        void loadingTask.destroy();
      }
    };
  }, [cancelRender, chart, clearPageCache, pdfUrl]);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) return;

    let cancelled = false;
    const renderId = renderIdRef.current + 1;
    renderIdRef.current = renderId;
    setPageRendering(true);

    const renderPage = async () => {
      const page = await getPage(pageNumber);
      const canvas = canvasRef.current;

      if (!page || !canvas) {
        if (!cancelled && renderId === renderIdRef.current) {
          setPageRendering(false);
        }
        return;
      }

      if (cancelled || renderId !== renderIdRef.current) {
        return;
      }

      const baseViewport = page.getViewport({ scale: 1, rotation });
      const nextPageSize = {
        width: baseViewport.width,
        height: baseViewport.height,
      };
      setPageSize((currentPageSize) =>
        currentPageSize?.width === nextPageSize.width &&
        currentPageSize.height === nextPageSize.height
          ? currentPageSize
          : nextPageSize
      );

      const safeRenderScale = clamp(renderScale, MIN_ZOOM, MAX_ZOOM);
      const viewport = page.getViewport({ scale: safeRenderScale, rotation });
      const pixelRatio = getCanvasPixelRatio(
        nextPageSize,
        safeRenderScale,
        devicePixelRatio
      );
      const outputWidth = Math.floor(viewport.width * pixelRatio);
      const outputHeight = Math.floor(viewport.height * pixelRatio);
      const context = canvas.getContext("2d", { alpha: false });

      if (!context) {
        throw new Error("Canvas 2D context is unavailable.");
      }

      if (outputWidth <= 0 || outputHeight <= 0) {
        releaseCanvasBackingStore(canvas);
        setPageRendering(false);
        return;
      }

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      canvas.width = outputWidth;
      canvas.height = outputHeight;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, outputWidth, outputHeight);

      const transform =
        pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined;

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform,
        background: "rgb(255,255,255)",
        annotationMode: pdfjs.AnnotationMode.ENABLE,
      });
      renderTaskRef.current = renderTask;

      await renderTask.promise;

      if (cancelled || renderId !== renderIdRef.current) {
        return;
      }

      renderTaskRef.current = null;
      setPageRendering(false);
      trimPageCache(pageNumber);
      preloadAdjacentPages(pageNumber);
    };

    renderPage().catch((renderError) => {
      if (cancelled || isPdfRenderCancellation(renderError)) {
        return;
      }

      console.error("PDF render error:", renderError);
      renderTaskRef.current = null;
      setErrorKey("pdf.failedToRender");
      setPageRendering(false);
    });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [
    devicePixelRatio,
    getPage,
    pageNumber,
    pdfDocument,
    preloadAdjacentPages,
    renderScale,
    rotation,
    trimPageCache,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const handleMouseDown = (event: MouseEvent) => {
      if (autoFit) return;
      if (event.button !== 0) return;

      const target = event.target as HTMLElement;
      if (target.closest("button,a")) return;

      isDraggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = { x: event.clientX, y: event.clientY };
      scrollStartRef.current = {
        left: container.scrollLeft,
        top: container.scrollTop,
      };
      event.preventDefault();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current) return;

      event.preventDefault();

      const dx = event.clientX - dragStartRef.current.x;
      const dy = event.clientY - dragStartRef.current.y;
      container.scrollLeft = scrollStartRef.current.left - dx;
      container.scrollTop = scrollStartRef.current.top - dy;
    };

    const stopDragging = () => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      setIsDragging(false);
    };

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);
    container.addEventListener("mouseleave", stopDragging);

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
      container.removeEventListener("mouseleave", stopDragging);
    };
  }, [autoFit]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const isWindows =
      typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

    const handleWheel = (event: WheelEvent) => {
      if (shouldWheelZoom(event, isWindows)) {
        event.preventDefault();
        captureZoomAnchor(event.clientX, event.clientY);
        setAutoFit(false);

        setTargetScale((previousScale) => {
          const delta = event.deltaY > 0 ? -WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
          const nextScale = clamp(previousScale + delta, MIN_ZOOM, MAX_ZOOM);
          scheduleRenderScale(nextScale);
          return nextScale;
        });

        return;
      }

      if (!autoFit) {
        const { left, top } = getWheelPanDelta(event);

        if (left !== 0 || top !== 0) {
          event.preventDefault();
          container.scrollBy({ left, top });
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => container.removeEventListener("wheel", handleWheel);
  }, [autoFit, captureZoomAnchor, scheduleRenderScale]);

  useEffect(() => {
    return () => {
      if (scaleTimerRef.current) {
        clearTimeout(scaleTimerRef.current);
      }
    };
  }, []);

  const changePage = (offset: number) => {
    setPageNumber((previousPageNumber) =>
      clamp(previousPageNumber + offset, 1, numPages)
    );
  };

  const zoomIn = () => {
    captureViewportCenterZoomAnchor();
    setAutoFit(false);
    setTargetScale((previousScale) => {
      const nextScale = clamp(previousScale + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
      scheduleRenderScale(nextScale);
      return nextScale;
    });
  };

  const zoomOut = () => {
    captureViewportCenterZoomAnchor();
    setAutoFit(false);
    setTargetScale((previousScale) => {
      const nextScale = clamp(previousScale - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
      scheduleRenderScale(nextScale);
      return nextScale;
    });
  };

  const toggleAutoFit = () => {
    captureViewportCenterZoomAnchor();
    setAutoFit((previousAutoFit) => {
      const nextAutoFit = !previousAutoFit;

      if (nextAutoFit) {
        setTargetScale(autoFitScale);
        scheduleRenderScale(autoFitScale);
      } else {
        setTargetScale(1);
        scheduleRenderScale(1);
      }

      return nextAutoFit;
    });
  };

  const rotateClockwise = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  if (errorKey) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-200 dark:bg-gray-900">
        <div className="text-center text-gray-400 dark:text-gray-400">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg">{t(errorKey)}</p>
          <p className="text-sm mt-2">{getFormattedChartName(chart)}</p>
          <p className="text-xs mt-1 opacity-70">{chart.PAGE_NUMBER}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-2 sm:p-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onOpenSidebar && (
            <button
              onClick={onOpenSidebar}
              className="lg:hidden p-2 text-gray-700 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-700 rounded flex-shrink-0"
              aria-label={t("pdf.openMenu")}
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <div className="text-gray-900 dark:text-white min-w-0">
            <p className="font-semibold text-sm sm:text-base truncate">
              {getFormattedChartName(chart)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {chart.PAGE_NUMBER}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={zoomOut}
              disabled={targetScale <= MIN_ZOOM || autoFit}
              className="p-1 sm:p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("pdf.zoomOut")}
              aria-label={t("pdf.zoomOut")}
            >
              <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <span
              className="text-gray-900 dark:text-white text-[10px] sm:text-xs w-8 sm:w-12 text-center"
              title={t("pdf.currentZoomLevel")}
            >
              {autoFit
                ? t("pdf.autoZoom")
                : `${Math.round(targetScale * 100)}%`}
            </span>
            <button
              onClick={zoomIn}
              disabled={targetScale >= MAX_ZOOM || autoFit}
              className="p-1 sm:p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title={t("pdf.zoomIn")}
              aria-label={t("pdf.zoomIn")}
            >
              <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>

          <button
            onClick={toggleAutoFit}
            className={`flex p-1 sm:p-1.5 ml-1 sm:ml-2 rounded transition-colors ${
              autoFit
                ? "bg-blue-500 text-white"
                : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
            title={t("pdf.fitToWindow")}
            aria-label={t("pdf.fitToWindow")}
          >
            <Maximize2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            onClick={rotateClockwise}
            className="flex p-1 sm:p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            title={t("pdf.rotateClockwise")}
            aria-label={t("pdf.rotateClockwise")}
          >
            <RotateCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          {isGeoreferenceable(chart) && onShowOnMap && (
            <button
              onClick={() => onShowOnMap(pageNumber)}
              disabled={!!georefLoading}
              className={`flex p-1 sm:p-1.5 ml-1 rounded transition-colors ${
                georefLoading
                  ? "bg-blue-500 text-white"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
              title={t("pdf.showOnMap")}
              aria-label={t("pdf.showOnMap")}
            >
              {georefLoading ? (
                <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <MapIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              )}
            </button>
          )}

          {bookmarkedCharts.length > 1 &&
            (() => {
              const currentIndex = bookmarkedCharts.findIndex(
                (bookmarkedChart) => bookmarkedChart.ChartId === chart.ChartId
              );
              const displayIndex = currentIndex >= 0 ? currentIndex + 1 : 1;

              return (
                <div className="hidden md:flex items-center gap-1 ml-2 pl-2 border-l border-gray-300 dark:border-gray-600">
                  <button
                    onClick={() => onNavigateToBookmark("prev")}
                    className="p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                    title={t("pdf.previousBookmark")}
                    aria-label={t("pdf.previousBookmark")}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1 px-2">
                    <Bookmark className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-gray-900 dark:text-white font-medium whitespace-nowrap">
                      {displayIndex} / {bookmarkedCharts.length}
                    </span>
                  </div>
                  <button
                    onClick={() => onNavigateToBookmark("next")}
                    className="p-1.5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                    title={t("pdf.nextBookmark")}
                    aria-label={t("pdf.nextBookmark")}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })()}
        </div>
      </div>

      <div
        ref={containerRef}
        className={`pdf-viewer-scroll flex-1 bg-gray-200 dark:bg-gray-900 ${
          autoFit
            ? "p-2 sm:p-4 overflow-hidden flex items-center justify-center"
            : "p-0 overflow-auto auto-hide-scrollbar"
        } ${isDragging ? "select-none" : ""} ${isScrolling ? "scrolling" : ""}`}
        style={{
          cursor: autoFit ? "default" : isDragging ? "grabbing" : "grab",
          userSelect: isDragging ? "none" : "auto",
        }}
      >
        <div
          className={autoFit ? "relative" : "pdf-page-stage"}
          style={{
            width: autoFit ? undefined : `${manualStageWidth}px`,
            height: autoFit ? undefined : `${manualStageHeight}px`,
            minWidth: autoFit ? undefined : "100%",
            minHeight: autoFit ? undefined : "100%",
            display: autoFit ? undefined : "flex",
            justifyContent: autoFit
              ? undefined
              : centerManualPageHorizontally
                ? "center"
                : "flex-start",
            alignItems: autoFit
              ? undefined
              : centerManualPageVertically
                ? "center"
                : "flex-start",
            padding: autoFit ? undefined : MANUAL_PAGE_PADDING,
            boxSizing: autoFit ? undefined : "border-box",
          }}
        >
          <div
            className="relative flex-shrink-0"
            style={{
              width: displayWidth ? `${displayWidth}px` : undefined,
              height: displayHeight ? `${displayHeight}px` : undefined,
            }}
          >
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-900 dark:text-white text-sm pointer-events-none">
                {documentLoading ? t("pdf.loadingPdf") : t("pdf.renderingPdf")}
              </div>
            )}
            <canvas
              ref={canvasRef}
              className={`pdf-canvas block shadow-lg bg-white ${
                loading ? "opacity-60" : "opacity-100"
              }`}
              style={{
                width: displayWidth ? `${displayWidth}px` : undefined,
                height: displayHeight ? `${displayHeight}px` : undefined,
                filter: invertColors ? "invert(1) hue-rotate(180deg)" : "none",
                transition: "opacity 0.12s ease-out, filter 0.12s ease-out",
              }}
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-2 sm:px-4 py-2 flex items-center justify-between">
        <button
          onClick={() => changePage(-1)}
          disabled={pageNumber <= 1}
          className="px-2 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="hidden sm:inline">&lt; {t("pdf.prev")}</span>
          <span className="sm:hidden">&lt;</span>
        </button>

        <div className="text-center flex-1 px-2">
          <div className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white truncate">
            {chart.ChartTypeEx_CH ? tChartType(chart.ChartTypeEx_CH) : "TAXI"}
          </div>
          {!documentLoading && (
            <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {pageNumber} / {numPages}
            </div>
          )}
        </div>

        <button
          onClick={() => changePage(1)}
          disabled={pageNumber >= numPages}
          className="px-2 sm:px-4 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="hidden sm:inline">{t("pdf.next")} &gt;</span>
          <span className="sm:hidden">&gt;</span>
        </button>
      </div>
    </div>
  );
}
