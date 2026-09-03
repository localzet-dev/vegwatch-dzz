import {
  authenticateLocalUser,
  createLocalSession,
  isLocalAuthEnabled,
  normalizeEmail,
  sessionCookie,
  validatePassword,
} from "@/lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalAuthEnabled()) {
    return Response.json({ error: "Локальный вход отключён" }, { status: 404 });
  }

  let payload: { email?: string; password?: string };
  try {
    payload = (await request.json()) as { email?: string; password?: string };
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const email = normalizeEmail(payload.email ?? "");
  const password = payload.password ?? "";
  if (!email || !email.includes("@") || validatePassword(password)) {
    return Response.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  const user = await authenticateLocalUser(email, password);
  if (!user) {
    return Response.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  const session = await createLocalSession(user.id);
  return Response.json(
    { user },
    { headers: { "set-cookie": sessionCookie(session.token, request) } },
  );
}
