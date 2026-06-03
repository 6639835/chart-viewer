"use client";

import { getName, getVersion } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  groupChartsByAirport,
  parseCSV,
  parsePerAirportCSV,
} from "@/lib/chartParser";
import type { AppConfig } from "@/types/config";
import type { GroupedCharts } from "@/types/chart";
import type { GeorefResult } from "@/types/georef";

export interface AppInfo {
  name: string;
  version: string;
}

export interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface ChartSource {
  format: "old" | "new";
  airportIcao: string | null;
  content: string;
}

interface ChartSourcesResponse {
  sources: ChartSource[];
}

type UpdateState = {
  pending: Update | null;
  downloadStartedAt: number;
  downloadedBytes: number;
  downloadTotal: number;
};

const updateState: UpdateState = {
  pending: null,
  downloadStartedAt: 0,
  downloadedBytes: 0,
  downloadTotal: 0,
};

const CHART_PDF_PROTOCOL = "chart-pdf";

function parseChartSource(source: ChartSource) {
  if (source.format === "old") {
    return parseCSV(source.content);
  }

  return parsePerAirportCSV(source.content, source.airportIcao ?? "");
}

function getDownloadProgress(): DownloadProgress {
  const elapsedSeconds = Math.max(
    (Date.now() - updateState.downloadStartedAt) / 1000,
    1
  );

  return {
    bytesPerSecond: updateState.downloadedBytes / elapsedSeconds,
    percent:
      updateState.downloadTotal > 0
        ? Math.min(
            (updateState.downloadedBytes / updateState.downloadTotal) * 100,
            100
          )
        : 0,
    transferred: updateState.downloadedBytes,
    total: updateState.downloadTotal,
  };
}

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  return invoke<AppConfig>("save_config", { config });
}

export async function loadGroupedCharts(): Promise<GroupedCharts> {
  const response = await invoke<ChartSourcesResponse>("read_chart_sources");
  const charts = response.sources.flatMap(parseChartSource);
  return groupChartsByAirport(charts);
}

export function getPdfUrl(filename: string): string {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      return convertFileSrc(filename, CHART_PDF_PROTOCOL);
    } catch {
      // Fall back to the macOS/Linux protocol shape for non-Tauri browser tests.
    }
  }

  return `${CHART_PDF_PROTOCOL}://localhost/${encodeURIComponent(filename)}`;
}

export async function georeferenceChart(
  chartId: string,
  filePath: string,
  waypointFilePaths: string[] = [],
  pageNumber?: number
): Promise<GeorefResult> {
  return invoke<GeorefResult>("georeference_chart", {
    chartId,
    filePath,
    waypointFilePaths,
    pageNumber: pageNumber ?? null,
  });
}

export interface GeorefPreloadRequest {
  chartId: string;
  filePath: string;
  waypointFilePaths?: string[];
  pageNumber?: number;
}

export interface GeorefCacheStatus {
  ready: boolean;
}

export interface GeorefCacheSummary {
  ready: number;
  total: number;
}

export interface GeorefPreloadStatus {
  running: boolean;
  useMultiprocess: boolean;
  workerCount: number;
  startedJobs: number;
  activeJobs: number;
  totalJobs: number;
  processedJobs: number;
  failedJobs: number;
}

export async function getGeoreferenceCacheStatus(
  filePath: string,
  waypointFilePaths: string[] = [],
  pageNumber?: number
): Promise<GeorefCacheStatus> {
  return invoke<GeorefCacheStatus>("get_georeference_cache_status", {
    filePath,
    waypointFilePaths,
    pageNumber: pageNumber ?? null,
  });
}

export async function getGeoreferenceCacheSummary(
  requests: GeorefPreloadRequest[]
): Promise<GeorefCacheSummary> {
  return invoke<GeorefCacheSummary>("get_georeference_cache_summary", {
    requests,
  });
}

export async function preloadGeoreferenceCharts(
  requests: GeorefPreloadRequest[],
  options: { useMultiprocess?: boolean } = {}
): Promise<void> {
  return invoke("preload_georeference_charts", {
    requests,
    useMultiprocess: options.useMultiprocess ?? true,
  });
}

export async function getGeoreferencePreloadStatus(): Promise<GeorefPreloadStatus> {
  return invoke<GeorefPreloadStatus>("get_georeference_preload_status");
}

export interface AirportCoord {
  icao: string;
  lat: number;
  lon: number;
}

export async function readAirportCoords(): Promise<AirportCoord[]> {
  return invoke<AirportCoord[]>("read_airport_coords");
}

export async function selectDirectory(options: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: options.title,
    defaultPath: options.defaultPath,
  });

  return typeof selected === "string" ? selected : null;
}

export async function getAppInfo(): Promise<AppInfo> {
  const [name, version] = await Promise.all([getName(), getVersion()]);
  return { name, version };
}

export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  updateState.pending = await check();
  const update = updateState.pending;
  if (!update) {
    return null;
  }

  return {
    version: update.version,
    releaseDate: update.date,
    releaseNotes: update.body,
  };
}

export async function downloadUpdate(
  onProgress: (progress: DownloadProgress) => void
): Promise<UpdateInfo | null> {
  if (!updateState.pending) {
    updateState.pending = await check();
  }

  const update = updateState.pending;
  if (!update) {
    return null;
  }

  updateState.downloadStartedAt = Date.now();
  updateState.downloadedBytes = 0;
  updateState.downloadTotal = 0;

  await update.download((event: DownloadEvent) => {
    if (event.event === "Started") {
      updateState.downloadTotal = event.data.contentLength ?? 0;
      updateState.downloadedBytes = 0;
    }

    if (event.event === "Progress") {
      updateState.downloadedBytes += event.data.chunkLength;
    }

    onProgress(getDownloadProgress());
  });

  return {
    version: update.version,
    releaseDate: update.date,
    releaseNotes: update.body,
  };
}

export async function installUpdate(): Promise<void> {
  const update = updateState.pending;
  if (!update) {
    return;
  }

  await update.install();
  await relaunch();
}

export async function startGdl90Listener(port: number): Promise<void> {
  return invoke("start_gdl90_listener", { port });
}

export async function stopGdl90Listener(): Promise<void> {
  return invoke("stop_gdl90_listener");
}
