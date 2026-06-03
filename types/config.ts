export interface AppConfig {
  chartsDirectory: string;
  csvDirectory: string;
  gdl90Port?: number;
  preloadGeoreferences?: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  chartsDirectory: "charts",
  csvDirectory: "csv",
  gdl90Port: 4000,
  preloadGeoreferences: true,
};
