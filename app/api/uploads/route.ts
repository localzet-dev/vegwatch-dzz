import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { datasets } from "@/db/schema";
import { canUpload, getRequestProfile } from "@/lib/access";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["csv", "tsv", "tif", "tiff", "json", "geojson", "zip"];

function safeFileName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function kindFromName(name: string): "table" | "raster" | "vector" | "archive" | null {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (extension === "csv" || extension === "tsv") return "table";
  if (extension === "tif" || extension === "tiff") return "raster";
  if (extension === "json" || extension === "geojson") return "vector";
  if (extension === "zip") return "archive";
  return null;
}

export async function GET() {
  const profile = await getRequestProfile();
  if (!profile) return Response.json({ error: "Требуется вход" }, { status: 401 });

  const db = getDb();
  const rows = profile.role === "admin"
    ? await db.select().from(datasets).orderBy(desc(datasets.createdAt)).limit(100)
    : await db
        .select()
        .from(datasets)
        .where(eq(datasets.ownerId, profile.id))
        .orderBy(desc(datasets.createdAt))
        .limit(100);
  return Response.json({ datasets: rows });
}

export async function POST(request: Request) {
  const profile = await getRequestProfile();
  if (!profile) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (!canUpload(profile.role)) {
    return Response.json({ error: "У вашей роли нет права загружать данные" }, { status: 403 });
  }

  const encodedName = request.headers.get("x-file-name") ?? "";
  let decodedName = encodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    return Response.json({ error: "Некорректное имя файла" }, { status: 400 });
  }
  const fileName = safeFileName(decodedName);
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const sizeBytes = Number(request.headers.get("x-file-size"));
  const kind = kindFromName(fileName);

  if (!fileName || !kind || !ALLOWED_EXTENSIONS.includes(extension)) {
    return Response.json({ error: "Поддерживаются GeoTIFF, CSV, GeoJSON и ZIP" }, { status: 415 });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_SIZE) {
    return Response.json({ error: "Размер файла должен быть от 1 байта до 500 МБ" }, { status: 413 });
  }
  if (!request.body) return Response.json({ error: "Файл пуст" }, { status: 400 });

  const id = crypto.randomUUID();
  const objectKey = `${profile.id}/${id}/${fileName}`;
  const contentType = request.headers.get("content-type") || "application/octet-stream";

  await env.BUCKET.put(objectKey, request.body, {
    httpMetadata: { contentType },
    customMetadata: { ownerId: profile.id, datasetId: id, kind },
  });

  try {
    const [created] = await getDb()
      .insert(datasets)
      .values({ id, ownerId: profile.id, fileName, objectKey, contentType, kind, sizeBytes })
      .returning();
    return Response.json({ dataset: created }, { status: 201 });
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
}
