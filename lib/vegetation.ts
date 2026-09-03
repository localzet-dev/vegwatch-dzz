export type SeriesPoint = {
  date: string;
  label: string;
  value: number;
  baseline: number;
  lower: number;
  anomaly: boolean;
};

export type FieldZone = {
  id: string;
  name: string;
  score: number;
  status: "normal" | "watch" | "critical";
  path: string;
};

export const FIELD_ZONES: FieldZone[] = [
  { id: "z1", name: "Контур 01", score: 91, status: "normal", path: "M30 48 L224 30 L244 136 L54 155 Z" },
  { id: "z2", name: "Контур 02", score: 84, status: "normal", path: "M252 28 L446 42 L432 150 L245 136 Z" },
  { id: "z3", name: "Контур 03", score: 68, status: "watch", path: "M455 44 L676 70 L648 173 L432 150 Z" },
  { id: "z4", name: "Контур 04", score: 77, status: "watch", path: "M54 163 L246 144 L264 272 L74 296 Z" },
  { id: "z5", name: "Контур 05", score: 42, status: "critical", path: "M248 145 L432 158 L417 284 L265 272 Z" },
  { id: "z6", name: "Контур 06", score: 87, status: "normal", path: "M438 159 L646 181 L620 298 L418 284 Z" },
  { id: "z7", name: "Контур 07", score: 73, status: "watch", path: "M78 304 L263 281 L274 369 L98 390 Z" },
  { id: "z8", name: "Контур 08", score: 93, status: "normal", path: "M270 282 L618 306 L601 391 L275 370 Z" },
];

export const DEMO_SERIES: SeriesPoint[] = [
  ["2026-04-04", 0.24, 0.23],
  ["2026-04-14", 0.29, 0.28],
  ["2026-04-24", 0.37, 0.36],
  ["2026-05-04", 0.47, 0.46],
  ["2026-05-14", 0.57, 0.56],
  ["2026-05-24", 0.65, 0.64],
  ["2026-06-03", 0.71, 0.7],
  ["2026-06-13", 0.76, 0.75],
  ["2026-06-23", 0.78, 0.78],
  ["2026-07-03", 0.76, 0.79],
  ["2026-07-13", 0.69, 0.78],
  ["2026-07-23", 0.51, 0.76],
  ["2026-08-02", 0.43, 0.73],
  ["2026-08-12", 0.45, 0.69],
  ["2026-08-22", 0.54, 0.64],
  ["2026-08-30", 0.59, 0.6],
].map(([date, value, baseline]) => {
  const actual = value as number;
  const norm = baseline as number;
  return {
    date: date as string,
    label: formatDate(date as string),
    value: actual,
    baseline: norm,
    lower: Math.max(-1, norm - 0.12),
    anomaly: actual < norm - 0.12,
  };
});

export const DATA_SOURCES = [
  {
    name: "Landsat Collection 2",
    period: "1982 — настоящее время",
    resolution: "30 м",
    role: "Основной длинный ряд",
    note: "Surface Reflectance уже пригоден для расчёта индексов. Лучший старт для многолетней пиксельной нормы.",
    href: "https://www.usgs.gov/landsat-missions/landsat-collection-2",
  },
  {
    name: "MODIS MOD13Q1 v6.1",
    period: "2000 — настоящее время",
    resolution: "250 м / 16 дней",
    role: "Готовые NDVI и EVI",
    note: "Удобен для быстрого прототипа и регионального фона; не подходит для небольших полей.",
    href: "https://www.earthdata.nasa.gov/data/catalog/lpcloud-mod13q1-061",
  },
  {
    name: "NASA HLS v2",
    period: "Landsat + Sentinel-2",
    resolution: "30 м",
    role: "Плотный гармонизированный ряд",
    note: "L30 и S30 приведены к общей сетке и геометрии — меньше ручной межсенсорной нормализации.",
    href: "https://www.earthdata.nasa.gov/data/projects/hls",
  },
  {
    name: "Sentinel-2 L2A",
    period: "2015 — настоящее время",
    resolution: "10–20 м",
    role: "Текущий детальный мониторинг",
    note: "Подходит для границ полей, red-edge индексов и подтверждения свежей аномалии.",
    href: "https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2",
  },
  {
    name: "ERA5-Land",
    period: "1950 — настоящее время",
    resolution: "около 9 км",
    role: "Погодный контекст",
    note: "Температура, осадки, испарение и влажность почвы помогают объяснить стресс, но не заменяют ДЗЗ.",
    href: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land",
  },
  {
    name: "CHIRPS v3",
    period: "1981 — настоящее время",
    resolution: "0,05°",
    role: "История осадков",
    note: "Ряд осадков для индексов засухи и проверки вероятной причины аномалии.",
    href: "https://www.chc.ucsb.edu/data/chirps3",
  },
];

export function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(date).replace(".", "");
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function splitCsvLine(line: string, separator: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseNumber(value: string) {
  const result = Number(value.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(result) ? result : null;
}

export function buildSeriesFromCsv(text: string): SeriesPoint[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 4) throw new Error("В CSV должно быть не меньше трёх наблюдений");

  const separator = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitCsvLine(lines[0], separator).map((header) => header.trim().toLowerCase());
  const dateIndex = headers.findIndex((header) => ["date", "datetime", "timestamp", "дата", "time"].includes(header));
  const valueIndex = headers.findIndex((header) => ["ndvi", "evi", "ndmi", "ndre", "value", "index", "значение"].includes(header));
  const baselineIndex = headers.findIndex((header) => ["baseline", "median", "norm", "normal", "норма", "медиана"].includes(header));
  if (dateIndex < 0 || valueIndex < 0) throw new Error("Нужны столбцы date и ndvi/evi/ndmi/value");

  const rows = lines.slice(1).map((line) => splitCsvLine(line, separator)).map((cells) => {
    const date = new Date(`${cells[dateIndex]?.slice(0, 10)}T00:00:00Z`);
    const value = parseNumber(cells[valueIndex] ?? "");
    const baseline = baselineIndex >= 0 ? parseNumber(cells[baselineIndex] ?? "") : null;
    return { date, value, baseline };
  }).filter((row): row is { date: Date; value: number; baseline: number | null } => !Number.isNaN(row.date.getTime()) && row.value !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (rows.length < 3) throw new Error("Не удалось распознать даты и числовые значения");

  const latestYear = Math.max(...rows.map((row) => row.date.getUTCFullYear()));
  const history = new Map<string, number[]>();
  rows.filter((row) => row.date.getUTCFullYear() < latestYear).forEach((row) => {
    const key = `${row.date.getUTCMonth()}-${row.date.getUTCDate()}`;
    history.set(key, [...(history.get(key) ?? []), row.value]);
  });

  const baselines = rows.map((row, index) => {
    if (row.baseline !== null) return row.baseline;
    const key = `${row.date.getUTCMonth()}-${row.date.getUTCDate()}`;
    const historicalValues = history.get(key) ?? [];
    if (historicalValues.length) return median(historicalValues);
    return median(rows.slice(Math.max(0, index - 2), Math.min(rows.length, index + 3)).map((item) => item.value));
  });
  const residuals = rows.map((row, index) => row.value - baselines[index]);
  const residualMedian = median(residuals);
  const mad = median(residuals.map((value) => Math.abs(value - residualMedian)));
  const threshold = Math.max(0.08, 2.8 * 1.4826 * mad);
  const offset = Math.max(0, rows.length - 120);

  return rows.slice(offset).map((row, index) => {
    const baseline = baselines[offset + index];
    const isoDate = row.date.toISOString().slice(0, 10);
    return {
      date: isoDate,
      label: formatDate(isoDate),
      value: Number(row.value.toFixed(3)),
      baseline: Number(baseline.toFixed(3)),
      lower: Number((baseline - threshold).toFixed(3)),
      anomaly: row.value < baseline - threshold,
    };
  });
}
