import { asc, count, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getRequestProfile, type AccessRole } from "@/lib/access";
import { createLocalUser, isLocalAuthEnabled, normalizeEmail, validatePassword } from "@/lib/local-auth";

export const dynamic = "force-dynamic";

const ROLES: AccessRole[] = ["admin", "analyst", "viewer"];

export async function GET() {
  const profile = await getRequestProfile();
  if (!profile) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (profile.role !== "admin") return Response.json({ error: "Недостаточно прав" }, { status: 403 });

  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .orderBy(asc(users.displayName), asc(users.email))
    .limit(200);
  return Response.json({ users: rows });
}

export async function POST(request: Request) {
  const profile = await getRequestProfile();
  if (!profile) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (profile.role !== "admin") return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!isLocalAuthEnabled()) {
    return Response.json({ error: "Создание локальных аккаунтов доступно только в Docker-режиме" }, { status: 405 });
  }

  let payload: { email?: string; displayName?: string; password?: string; role?: AccessRole };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const email = normalizeEmail(payload.email ?? "");
  const displayName = (payload.displayName ?? "").trim();
  const password = payload.password ?? "";
  const passwordError = validatePassword(password);
  if (!email || !email.includes("@") || email.length > 254) {
    return Response.json({ error: "Укажите корректный email" }, { status: 400 });
  }
  if (!displayName || displayName.length > 80) {
    return Response.json({ error: "Имя должно содержать от 1 до 80 символов" }, { status: 400 });
  }
  if (!payload.role || !ROLES.includes(payload.role)) {
    return Response.json({ error: "Выберите корректную роль" }, { status: 400 });
  }
  if (passwordError) return Response.json({ error: passwordError }, { status: 400 });

  try {
    const user = await createLocalUser({ email, displayName, password, role: payload.role });
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать пользователя";
    return Response.json({ error: message }, { status: message.includes("уже существует") ? 409 : 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = await getRequestProfile();
  if (!profile) return Response.json({ error: "Требуется вход" }, { status: 401 });
  if (profile.role !== "admin") return Response.json({ error: "Недостаточно прав" }, { status: 403 });

  const payload = (await request.json()) as { userId?: string; role?: AccessRole };
  if (!payload.userId || !payload.role || !ROLES.includes(payload.role)) {
    return Response.json({ error: "Некорректная роль или пользователь" }, { status: 400 });
  }

  const db = getDb();
  if (payload.userId === profile.id && payload.role !== "admin") {
    const [{ value: adminCount }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.role, "admin"));
    if (adminCount <= 1) {
      return Response.json({ error: "Нельзя удалить последнего администратора" }, { status: 409 });
    }
  }

  const [updated] = await db
    .update(users)
    .set({ role: payload.role })
    .where(eq(users.id, payload.userId))
    .returning();
  if (!updated) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
  return Response.json({ user: updated });
}
