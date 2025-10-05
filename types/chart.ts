export interface ChartData {
  ChartId: string;
  AirportIcao: string;
  AirportIata: string;
  CityName: string;
  AirportName: string;
  ValidFrom: string;
  ValidUntil: string;
  FilePath: string;
  ChartName: string;
  FileSize: string;
  ChartTypeEx_CH: string;
  MD5: string;
  AD_HP_ID: string;
  PAGE_NUMBER: string;
  IS_SUP: string;
  SUP_REF_CHARTID: string;
  IS_MODIFIED: string;
}

export type ChartCategory = 'STAR' | 'APP' | 'TAXI' | 'SID' | 'OTHER' | '细则';

export interface GroupedCharts {
  [airport: string]: {
    [category in ChartCategory]?: ChartData[];
  };
}

export const CHART_TYPE_MAPPING: Record<string, ChartCategory> = {
  '机场细则': '细则',
  '其他': 'OTHER',
  '机场图_停机位置图': 'TAXI',
  '标准仪表进场图': 'STAR',
  '标准仪表离场图': 'SID',
  '仪表进近图_ILS': 'APP',
  '进近图_RNAV_RNP_RADAR_GPS_GNSS': 'APP',
  '机场障碍物图_精密进近地形图': 'OTHER',
  '仪表进近图_VOR': 'APP',
  '仪表进近图_NDB': 'APP',
  '最低监视引导高度图_放油区图': 'OTHER',
};

export const CATEGORY_ORDER: ChartCategory[] = ['STAR', 'APP', 'TAXI', 'SID', 'OTHER', '细则'];

