"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleDashed,
  Database,
  FileJson,
  FileSpreadsheet,
  Layers3,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MapPinned,
  Play,
  Radar,
  Satellite,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserPlus,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AccessRole, UserProfile } from "@/lib/access";
import { buildSeriesFromCsv, DATA_SOURCES, DEMO_SERIES, FIELD_ZONES, median, type FieldZone, type SeriesPoint } from "@/lib/vegetation";

type UploadItem = {
  id: string;
  datasetId?: string;
  name: string;
  size: number;
  kind: "table" | "raster" | "vector" | "archive" | "other";
  status: "uploading" | "ready" | "parsed" | "error";
  detail: string;
};

type TeamUser = {
  id: string;
  email: string;
  displayName: string;
  role: AccessRole;
  createdAt: string;
  lastSeenAt: string;
};

const ROLE_LABELS: Record<AccessRole, string> = {
  admin: "Администратор",
  analyst: "Аналитик",
  viewer: "Наблюдатель",
};

const chartConfig = {
  value: { label: "Наблюдение", color: "#b9f34a" },
  baseline: { label: "Медианная норма", color: "#68a88b" },
  lower: { label: "Нижняя граница", color: "#ff7a5c" },
} satisfies ChartConfig;

function fileKind(name: string): UploadItem["kind"] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "table";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "raster";
  if (lower.endsWith(".json") || lower.endsWith(".geojson")) return "vector";
  if (lower.endsWith(".zip")) return "archive";
  return "other";
}

function fileSize(value: number) {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / 1024 ** 2).toFixed(1)} МБ`;
}

function statusText(status: FieldZone["status"]) {
  if (status === "critical") return "Критично";
  if (status === "watch") return "Наблюдать";
  return "Норма";
}

function UploadIcon({ kind }: { kind: UploadItem["kind"] }) {
  if (kind === "table") return <FileSpreadsheet />;
  if (kind === "vector") return <FileJson />;
  if (kind === "archive") return <Archive />;
  return <Layers3 />;
}

function initialLetter(value: string) {
  return value.trim().charAt(0).toLocaleUpperCase("ru-RU") || "U";
}

export default function Dashboard({ profile, authMode }: { profile: UserProfile; authMode: "chatgpt" | "local" }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [series, setSeries] = useState<SeriesPoint[]>(DEMO_SERIES);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [datasetLabel, setDatasetLabel] = useState("Демо-набор · поле 12");
  const [selectedZoneId, setSelectedZoneId] = useState("z5");
  const [indexName, setIndexName] = useState("ndvi");
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [message, setMessage] = useState("Демо показывает сценарий водного стресса. Загрузите свои данные, чтобы заменить ряд.");
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [teamState, setTeamState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [teamMessage, setTeamMessage] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<AccessRole>("viewer");
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const mayUpload = profile.role === "admin" || profile.role === "analyst";
  const selectedZone = FIELD_ZONES.find((zone) => zone.id === selectedZoneId) ?? FIELD_ZONES[0];

  const summary = useMemo(() => {
    const anomalies = series.filter((point) => point.anomaly);
    const latest = series.at(-1);
    const recent = series.slice(-5);
    const ratio = recent.length
      ? median(recent.map((point) => point.baseline === 0 ? 1 : point.value / point.baseline))
      : 1;
    return {
      anomalyCount: anomalies.length,
      latest: latest?.value ?? 0,
      deviation: latest ? ((latest.value - latest.baseline) / Math.max(latest.baseline, 0.01)) * 100 : 0,
      health: Math.max(0, Math.min(100, Math.round(ratio * 100))),
    };
  }, [series]);

  useEffect(() => {
    const loadUploads = async () => {
      try {
        const response = await fetch("/api/uploads");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          datasets?: Array<{ id: string; fileName: string; sizeBytes: number; kind: UploadItem["kind"]; status: string }>;
        };
        if (!payload.datasets?.length) return;
        setUploads(payload.datasets.map((item) => ({
          id: `stored-${item.id}`,
          datasetId: item.id,
          name: item.fileName,
          size: item.sizeBytes,
          kind: item.kind,
          status: "ready",
          detail: item.status === "uploaded" ? "Сохранено онлайн" : item.status,
        })));
      } catch {
        // The dashboard remains useful with its demo dataset if history is temporarily unavailable.
      }
    };
    void loadUploads();
  }, []);

  useEffect(() => {
    if (profile.role !== "admin") return;
    const loadTeam = async () => {
      setTeamState("loading");
      try {
        const response = await fetch("/api/users");
        if (!response.ok) throw new Error("Не удалось загрузить пользователей");
        const payload = (await response.json()) as { users: TeamUser[] };
        setTeam(payload.users);
        setTeamState("ready");
      } catch (error) {
        setTeamState("error");
        setTeamMessage(error instanceof Error ? error.message : "Ошибка загрузки");
      }
    };
    void loadTeam();
  }, [profile.role]);

  const processFiles = async (incoming: FileList | File[]) => {
    if (!mayUpload) {
      setMessage("Роль «Наблюдатель» не может загружать данные. Обратитесь к администратору.");
      return;
    }
    const files = Array.from(incoming);
    if (!files.length) return;

    for (const file of files) {
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
      const kind = fileKind(file.name);
      const item: UploadItem = { id, name: file.name, size: file.size, kind, status: "uploading", detail: "Загрузка…" };
      setUploads((current) => [item, ...current]);

      try {
        if (kind === "other") throw new Error("Поддерживаются GeoTIFF, CSV, GeoJSON и ZIP");
        const response = await fetch("/api/uploads", {
          method: "POST",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-file-size": String(file.size),
          },
          body: file,
        });
        const payload = (await response.json()) as { dataset?: { id: string }; error?: string };
        if (!response.ok || !payload.dataset) throw new Error(payload.error || "Ошибка загрузки");

        let detail = "Сохранено онлайн";
        let status: UploadItem["status"] = "ready";
        if (kind === "table") {
          const parsed = buildSeriesFromCsv(await file.text());
          setSeries(parsed);
          setDatasetLabel(file.name);
          detail = `${parsed.length} наблюдений · сохранено`;
          status = "parsed";
          setMessage(`Распознано ${parsed.length} наблюдений. Можно запускать детектор аномалий.`);
        } else if (kind === "vector") {
          const json = JSON.parse(await file.text()) as { features?: unknown[] };
          detail = `${json.features?.length ?? 1} геообъектов · сохранено`;
          status = "parsed";
          setMessage("Границы распознаны и сохранены. Они готовы к растровому конвейеру.");
        } else {
          setMessage("Файл сохранён онлайн. Для расчёта растров подключим API вашего сервера.");
        }
        setUploads((current) => current.map((entry) => entry.id === id
          ? { ...entry, datasetId: payload.dataset?.id, status, detail }
          : entry));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Ошибка загрузки";
        setUploads((current) => current.map((entry) => entry.id === id ? { ...entry, status: "error", detail } : entry));
        setMessage(detail);
      }
    }
  };

  const runAnalysis = async () => {
    if (!mayUpload) {
      setMessage("Наблюдателю доступен просмотр готовых результатов, но не запуск расчёта.");
      return;
    }
    setIsAnalyzing(true);
    setMessage("Строим сезонную норму и проверяем устойчивые отклонения…");
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    setIsAnalyzing(false);
    setMessage(summary.anomalyCount
      ? `Найдено ${summary.anomalyCount} аномальных дат. Проверьте облачность и погодный контекст.`
      : "Устойчивых отрицательных отклонений не найдено.");
  };

  const changeRole = async (userId: string, role: AccessRole) => {
    setTeamMessage("Сохраняем роль…");
    try {
      const response = await fetch("/api/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const payload = (await response.json()) as { user?: TeamUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || "Не удалось изменить роль");
      setTeam((current) => current.map((user) => user.id === userId ? { ...user, role: payload.user!.role } : user));
      setTeamMessage("Роль обновлена");
    } catch (error) {
      setTeamMessage(error instanceof Error ? error.message : "Ошибка сохранения");
    }
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsCreatingUser(true);
    setTeamMessage("Создаём аккаунт…");
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: newUserEmail,
          displayName: newUserName,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      const payload = (await response.json()) as { user?: TeamUser; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error || "Не удалось создать пользователя");
      setTeam((current) => [...current, payload.user!].sort((left, right) => left.displayName.localeCompare(right.displayName, "ru")));
      setNewUserEmail("");
      setNewUserName("");
      setNewUserPassword("");
      setNewUserRole("viewer");
      setTeamMessage("Пользователь создан");
    } catch (error) {
      setTeamMessage(error instanceof Error ? error.message : "Ошибка создания");
    } finally {
      setIsCreatingUser(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true"><Leaf /></div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">VegWatch ДЗЗ</h1>
            <Badge className="border border-lime-400/25 bg-lime-400/10 text-lime-700 dark:text-lime-300">MVP</Badge>
          </div>
          <p className="hidden text-sm text-muted-foreground sm:block">Временные ряды и аномалии растительности</p>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="account-chip">
            <span className="account-avatar">{initialLetter(profile.displayName)}</span>
            <span className="hidden min-w-0 sm:block">
              <strong className="block max-w-40 truncate text-sm">{profile.displayName}</strong>
              <small>{ROLE_LABELS[profile.role]}</small>
            </span>
          </div>
          {authMode === "local" ? (
            <form method="post" action="/api/auth/logout">
              <Button type="submit" variant="ghost" size="icon-sm" aria-label="Выйти"><LogOut /></Button>
            </form>
          ) : (
            <Button variant="ghost" size="icon-sm" asChild>
              <a href="/signout-with-chatgpt?return_to=/" aria-label="Выйти"><LogOut /></a>
            </Button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] p-3 sm:p-5 lg:p-6">
        <div className="online-strip">
          <span className="status-dot" />
          <span>{authMode === "local" ? (
            <><strong>Автономный Docker-контур</strong> · локальные аккаунты · SQLite · файлы сохраняются на подключённом volume</>
          ) : (
            <><strong>Онлайн-контур активен</strong> · вход обязателен · права проверяются сервером · файлы сохраняются в объектном хранилище</>
          )}</span>
          <ShieldCheck className="ml-auto" />
        </div>

        <section className="workspace-grid" aria-label="Рабочая область анализа">
          <aside className="panel upload-panel">
            <div className="section-kicker"><span>01</span><span>Входные данные</span></div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Добавьте набор ДЗЗ</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                CSV анализируется сразу. GeoTIFF и ZIP сохраняются для вашего вычислительного сервера.
              </p>
            </div>

            <button
              type="button"
              className={`drop-zone ${isDragging ? "is-dragging" : ""} ${!mayUpload ? "is-disabled" : ""}`}
              onClick={() => mayUpload && fileInputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); if (mayUpload) setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                void processFiles(event.dataTransfer.files);
              }}
              disabled={!mayUpload}
            >
              <span className="drop-icon">{mayUpload ? <UploadCloud /> : <LockKeyhole />}</span>
              <span className="font-medium">{mayUpload ? "Перетащите файлы сюда" : "Доступ только на просмотр"}</span>
              <span className="text-sm text-muted-foreground">GeoTIFF, CSV, GeoJSON или ZIP · до 500 МБ</span>
              {mayUpload && <span className="drop-action">Выбрать файлы</span>}
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              multiple
              accept=".tif,.tiff,.csv,.tsv,.json,.geojson,.zip"
              onChange={(event) => {
                if (event.target.files) void processFiles(event.target.files);
                event.target.value = "";
              }}
              aria-label="Выбрать файлы ДЗЗ"
            />

            {uploads.length > 0 && (
              <div className="file-list" aria-live="polite">
                {uploads.slice(0, 4).map((file) => (
                  <div className="file-row" key={file.id}>
                    <span className={`file-kind file-kind-${file.kind}`}><UploadIcon kind={file.kind} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{file.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{fileSize(file.size)} · {file.detail}</span>
                    </span>
                    {file.status === "uploading" ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                      : file.status === "error" ? <AlertTriangle className="size-4 text-destructive" />
                      : <CheckCircle2 className="size-4 text-lime-600 dark:text-lime-300" />}
                  </div>
                ))}
              </div>
            )}

            <div className="config-block">
              <label className="control-label" htmlFor="index-select">Индекс для анализа</label>
              <Select value={indexName} onValueChange={setIndexName}>
                <SelectTrigger id="index-select" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ndvi">NDVI · общая активность</SelectItem>
                  <SelectItem value="ndre">NDRE · хлорофилл</SelectItem>
                  <SelectItem value="ndmi">NDMI · влажность</SelectItem>
                  <SelectItem value="evi">EVI · плотный покров</SelectItem>
                </SelectContent>
              </Select>
              <div className="algorithm-row">
                <span className="algorithm-icon"><ScanSearch /></span>
                <span><span className="block text-sm font-medium">Robust seasonal</span><span className="block text-xs text-muted-foreground">медиана + MAD, порог 2,8σ</span></span>
                <Check className="ml-auto size-4 text-lime-600 dark:text-lime-300" />
              </div>
            </div>

            <Button className="h-11 w-full bg-lime-400 text-[#0a1714] hover:bg-lime-300" onClick={() => void runAnalysis()} disabled={isAnalyzing || !mayUpload}>
              {isAnalyzing ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}
              {isAnalyzing ? "Анализируем…" : mayUpload ? "Рассчитать аномалии" : "Только просмотр"}
            </Button>
            <div className="message-box" role="status"><Sparkles /><p>{message}</p></div>
          </aside>

          <section className="panel map-panel" aria-labelledby="map-title">
            <div className="panel-heading">
              <div>
                <div className="section-kicker"><span>02</span><span>Пространственный контроль</span></div>
                <h2 id="map-title" className="mt-2 text-xl font-semibold tracking-tight">Карта состояния</h2>
              </div>
              <div className="map-toolbar">
                <Badge variant="outline" className="gap-1.5 bg-background/70"><Satellite /> Sentinel-2</Badge>
                <Badge variant="outline" className="gap-1.5 bg-background/70 uppercase">{indexName}</Badge>
              </div>
            </div>
            <div className="map-stage">
              <div className="map-coordinates">55.7558° N · 37.6176° E</div>
              <div className="north-mark" aria-hidden="true">N</div>
              <svg viewBox="0 0 710 420" className="field-map" role="img" aria-label="Схема полей, окрашенных по состоянию растительности">
                <defs>
                  <pattern id="smallGrid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth="0.55" /></pattern>
                  <filter id="selectedGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#b9f34a" floodOpacity="0.45" /></filter>
                </defs>
                <rect width="710" height="420" className="map-grid" fill="url(#smallGrid)" />
                <path d="M0 345 C126 290 170 395 302 331 C445 262 524 389 710 312" className="water-line" />
                {FIELD_ZONES.map((zone) => (
                  <g key={zone.id} role="button" tabIndex={0} aria-label={`${zone.name}: ${statusText(zone.status)}, ${zone.score} баллов`}
                    onClick={() => setSelectedZoneId(zone.id)}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedZoneId(zone.id); } }}
                    className="zone-group">
                    <path d={zone.path} className={`field-zone zone-${zone.status} ${selectedZoneId === zone.id ? "is-selected" : ""}`} filter={selectedZoneId === zone.id ? "url(#selectedGlow)" : undefined} />
                  </g>
                ))}
              </svg>
              <div className="map-legend"><span><i className="legend-normal" /> Норма</span><span><i className="legend-watch" /> Наблюдать</span><span><i className="legend-critical" /> Критично</span></div>
              <div className="selected-card"><span className={`risk-dot risk-${selectedZone.status}`} /><span><span className="block text-xs text-muted-foreground">Выбранный участок</span><strong className="block text-sm">{selectedZone.name}</strong></span><strong className="ml-auto font-mono text-lg">{selectedZone.score}</strong></div>
            </div>
            <div className="map-metrics"><div><span>Покрытие</span><strong>326 га</strong></div><div><span>Облачность</span><strong>7%</strong></div><div><span>Последняя сцена</span><strong>30 авг</strong></div></div>
          </section>

          <aside className="panel summary-panel">
            <div className="section-kicker"><span>03</span><span>Интерпретация</span></div>
            <div className="score-card">
              <div className="score-ring" style={{ "--score": `${summary.health * 3.6}deg` } as CSSProperties}><div><strong>{summary.health}</strong><span>/100</span></div></div>
              <div><Badge className="border border-amber-400/25 bg-amber-400/10 text-amber-700 dark:text-amber-300">Требует внимания</Badge><p className="mt-2 text-sm leading-5 text-muted-foreground">Снижение индекса устойчиво и пространственно связано.</p></div>
            </div>
            <div className="metric-stack">
              <div className="metric-row"><span className="metric-icon metric-icon-lime"><Activity /></span><span><small>Текущий {indexName.toUpperCase()}</small><strong>{summary.latest.toFixed(2)}</strong></span><Badge variant="outline" className={summary.deviation < 0 ? "text-rose-500" : "text-lime-600"}>{summary.deviation > 0 ? "+" : ""}{summary.deviation.toFixed(0)}%</Badge></div>
              <div className="metric-row"><span className="metric-icon metric-icon-coral"><AlertTriangle /></span><span><small>Аномальные даты</small><strong>{summary.anomalyCount}</strong></span><span className="metric-note">из {series.length}</span></div>
              <div className="metric-row"><span className="metric-icon metric-icon-blue"><MapPinned /></span><span><small>Зона риска</small><strong>41,8 га</strong></span><span className="metric-note">12,8%</span></div>
            </div>
            <div className="alert-card">
              <div className="flex items-start gap-3"><span className="alert-pulse"><Radar /></span><div><div className="flex items-center justify-between gap-2"><strong className="text-sm">Вероятный водный стресс</strong><span className="confidence">78%</span></div><p className="mt-1 text-sm leading-5 text-muted-foreground">NDVI ниже нормы, падение началось 23 июля. Причину нужно подтвердить погодой или осмотром.</p></div></div>
              <div className="mt-4 space-y-2"><div className="flex justify-between text-xs"><span>Уверенность модели</span><span>0,78</span></div><Progress value={78} className="h-1.5" /></div>
            </div>
            <div className="explain-list"><p className="control-label">Почему сработал сигнал</p><span><CheckCircle2 /> 3 последовательные даты</span><span><CheckCircle2 /> Отклонение ниже робастного порога</span><span><CircleDashed /> Погода пока не подключена</span></div>
          </aside>
        </section>

        <Tabs defaultValue="series" className="mt-5">
          <div className="tab-bar">
            <TabsList className="h-10 bg-muted/70 p-1">
              <TabsTrigger value="series" className="px-4">Временной ряд</TabsTrigger>
              <TabsTrigger value="sources" className="px-4">Открытая история</TabsTrigger>
              <TabsTrigger value="pipeline" className="px-4">Конвейер</TabsTrigger>
              {profile.role === "admin" && <TabsTrigger value="users" className="px-4"><Users /> Пользователи</TabsTrigger>}
            </TabsList>
            <p className="truncate text-sm text-muted-foreground">Источник: {datasetLabel}</p>
          </div>

          <TabsContent value="series" className="mt-3">
            <section className="panel chart-panel" aria-labelledby="series-title">
              <div className="panel-heading">
                <div><div className="flex items-center gap-2"><h2 id="series-title" className="text-lg font-semibold">Сезонная динамика</h2><Badge variant="outline" className="uppercase">{indexName}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Линия нормы, нижний робастный порог и фактические наблюдения</p></div>
                <div className="chart-legend-inline"><span><i className="chart-value" />Наблюдение</span><span><i className="chart-base" />Норма</span><span><i className="chart-risk" />Порог</span></div>
              </div>
              <ChartContainer config={chartConfig} className="h-[310px] w-full aspect-auto">
                <AreaChart data={series} margin={{ left: -10, right: 12, top: 18, bottom: 2 }}>
                  <defs><linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-value)" stopOpacity={0.25} /><stop offset="100%" stopColor="var(--color-value)" stopOpacity={0.01} /></linearGradient></defs>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis domain={[-0.05, 1]} tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toFixed(1)} />
                  <ChartTooltip cursor={{ stroke: "#8aa89b", strokeDasharray: "4 4" }} content={<ChartTooltipContent indicator="line" />} />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Area type="monotone" dataKey="value" stroke="none" fill="url(#valueFill)" />
                  <Line type="monotone" dataKey="lower" stroke="var(--color-lower)" strokeWidth={1.4} strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey="baseline" stroke="var(--color-baseline)" strokeWidth={2} strokeDasharray="3 4" dot={false} />
                  <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={3} dot={false} activeDot={{ r: 5, fill: "var(--color-value)", stroke: "var(--background)", strokeWidth: 2 }} />
                </AreaChart>
              </ChartContainer>
            </section>
          </TabsContent>

          <TabsContent value="sources" className="mt-3">
            <section className="panel sources-panel">
              <div className="sources-intro"><div><div className="section-kicker"><Database /><span>Открытые данные</span></div><h2 className="mt-2 text-2xl font-semibold tracking-tight">Где взять многолетнюю норму</h2></div><p>Практичный старт: Landsat для длинной истории, Sentinel-2 для детализации, MODIS для быстрой проверки. Погода помогает объяснять, но не доказывает причину стресса.</p></div>
              <div className="source-grid">
                {DATA_SOURCES.map((source) => (
                  <a key={source.name} href={source.href} target="_blank" rel="noreferrer" className="source-card">
                    <div className="flex items-start justify-between gap-3"><div><span className="source-role">{source.role}</span><h3>{source.name}</h3></div><ArrowUpRight /></div>
                    <div className="source-meta"><span>{source.period}</span><span>{source.resolution}</span></div><p>{source.note}</p>
                  </a>
                ))}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="pipeline" className="mt-3">
            <section className="panel pipeline-panel">
              <div>
                <div className="section-kicker"><UploadCloud /><span>Контракт входа</span></div><h2 className="mt-2 text-xl font-semibold">Текущий срез разработки</h2>
                <ul className="check-list"><li><Check /> Онлайн-вход и серверная проверка ролей</li><li><Check /> Потоковая загрузка GeoTIFF/ZIP до 500 МБ</li><li><Check /> CSV с <code>date + ndvi/evi/ndmi/value</code></li><li><Check /> Необязательный столбец <code>baseline</code></li><li><Check /> Робастный детектор на загруженном ряду</li></ul>
              </div>
              <div className="pipeline-flow">
                {[["01", "Приём", "GeoTIFF / CSV / GeoJSON / ZIP", UploadCloud], ["02", "Нормализация", "CRS, даты, маски, индексы", Layers3], ["03", "Норма", "Медиана по дню сезона + MAD", Database], ["04", "Сигнал", "Карта, ряд, уровень уверенности", AlertTriangle]].map(([step, title, text, Icon], index) => {
                  const StepIcon = Icon as typeof UploadCloud;
                  return <div className="pipeline-step" key={step as string}><span className="pipeline-number">{step as string}</span><span className="pipeline-icon"><StepIcon /></span><div><strong>{title as string}</strong><p>{text as string}</p></div>{index < 3 && <span className="pipeline-line" />}</div>;
                })}
              </div>
              <div className="next-block"><Satellite /><div><strong>Для подключения вашего сервера</strong><p>Нужны URL API, OpenAPI-файл и способ авторизации. После этого кнопка анализа будет создавать реальное задание обработки.</p></div></div>
            </section>
          </TabsContent>

          {profile.role === "admin" && (
            <TabsContent value="users" className="mt-3">
              <section className="panel users-panel">
                <div className="users-header"><div><div className="section-kicker"><ShieldCheck /><span>RBAC</span></div><h2 className="mt-2 text-2xl font-semibold tracking-tight">Пользователи и уровни доступа</h2><p>Новый пользователь получает роль наблюдателя. Все изменения проверяются и сохраняются на сервере.</p></div><Badge variant="outline">{team.length} пользователей</Badge></div>
                {authMode === "local" && (
                  <form className="new-user-form" onSubmit={createUser}>
                    <div className="new-user-title"><UserPlus /><span><strong>Новый пользователь</strong><small>Создайте аккаунт и сразу назначьте уровень доступа.</small></span></div>
                    <label><span>Имя</span><Input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} maxLength={80} required /></label>
                    <label><span>Email</span><Input type="email" value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} maxLength={254} autoComplete="off" required /></label>
                    <label><span>Пароль</span><Input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required /></label>
                    <label><span>Роль</span><Select value={newUserRole} onValueChange={(role) => setNewUserRole(role as AccessRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Администратор</SelectItem><SelectItem value="analyst">Аналитик</SelectItem><SelectItem value="viewer">Наблюдатель</SelectItem></SelectContent></Select></label>
                    <Button type="submit" className="new-user-submit" disabled={isCreatingUser}>{isCreatingUser ? <LoaderCircle className="animate-spin" /> : <UserPlus />}{isCreatingUser ? "Создаём…" : "Создать"}</Button>
                  </form>
                )}
                {teamState === "loading" ? <div className="loading-row"><LoaderCircle className="animate-spin" /> Загружаем список…</div> : (
                  <div className="user-table" role="table" aria-label="Пользователи">
                    <div className="user-table-head" role="row"><span>Пользователь</span><span>Роль</span><span>Последний вход</span></div>
                    {team.map((user) => (
                      <div className="user-table-row" role="row" key={user.id}>
                        <div className="user-cell"><span className="account-avatar">{initialLetter(user.displayName)}</span><span><strong>{user.displayName}</strong><small>{user.email}{user.id === profile.id ? " · вы" : ""}</small></span></div>
                        <Select value={user.role} onValueChange={(role) => void changeRole(user.id, role as AccessRole)}>
                          <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="admin">Администратор</SelectItem><SelectItem value="analyst">Аналитик</SelectItem><SelectItem value="viewer">Наблюдатель</SelectItem></SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(user.lastSeenAt))}</span>
                      </div>
                    ))}
                  </div>
                )}
                {teamMessage && <div className="team-message" role="status">{teamMessage}</div>}
                <div className="role-grid"><div><strong>Администратор</strong><p>Пользователи, роли, все данные и расчёты.</p></div><div><strong>Аналитик</strong><p>Загрузка данных, запуск анализа и экспорт.</p></div><div><strong>Наблюдатель</strong><p>Только просмотр карт, графиков и отчётов.</p></div></div>
              </section>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </main>
  );
}
