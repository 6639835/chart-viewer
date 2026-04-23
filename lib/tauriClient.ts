"use client";

import { getName, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
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

let pendingUpdate: Update | null = null;
let downloadStartedAt = 0;
let downloadedBytes = 0;
let downloadTotal = 0;

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  return invoke<AppConfig>("save_config", { config });
}

export async function loadGroupedCharts(): Promise<GroupedCharts> {
  const response = await invoke<ChartSourcesResponse>("read_chart_sources");
  const charts = response.sources.flatMap((source) => {
    if (source.format === "old") {
      return parseCSV(source.content);
    }

    return parsePerAirportCSV(source.content, source.airportIcao ?? "");
  });

  return groupChartsByAirport(charts);
}

export function getPdfUrl(filename: string): string {
  return `chart-pdf://localhost/${encodeURIComponent(filename)}`;
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
  pendingUpdate = await check();
  if (!pendingUpdate) {
    return null;
  }

  return {
    version: pendingUpdate.version,
    releaseDate: pendingUpdate.date,
    releaseNotes: pendingUpdate.body,
  };
}

export async function downloadUpdate(
  onProgress: (progress: DownloadProgress) => void
): Promise<UpdateInfo | null> {
  if (!pendingUpdate) {
    pendingUpdate = await check();
  }

  if (!pendingUpdate) {
    return null;
  }

  downloadStartedAt = Date.now();
  downloadedBytes = 0;
  downloadTotal = 0;

  await pendingUpdate.download((event: DownloadEvent) => {
    if (event.event === "Started") {
      downloadTotal = event.data.contentLength ?? 0;
      downloadedBytes = 0;
    }

    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
    }

    const elapsedSeconds = Math.max((Date.now() - downloadStartedAt) / 1000, 1);
    onProgress({
      bytesPerSecond: downloadedBytes / elapsedSeconds,
      percent: downloadTotal > 0 ? (downloadedBytes / downloadTotal) * 100 : 0,
      transferred: downloadedBytes,
      total: downloadTotal,
    });
  });

  return {
    version: pendingUpdate.version,
    releaseDate: pendingUpdate.date,
    releaseNotes: pendingUpdate.body,
  };
}

export async function installUpdate(): Promise<void> {
  if (!pendingUpdate) {
    return;
  }

  await pendingUpdate.install();
  await relaunch();
}
