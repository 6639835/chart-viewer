export interface AppConfig {
  chartsDirectory: string;
  csvDirectory: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  chartsDirectory: "charts",
  csvDirectory: "csv",
};
