import { clearSessionCookie, deleteLocalSession, isLocalAuthEnabled } from "@/lib/local-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalAuthEnabled()) {
    return Response.json({ error: "Локальный вход отключён" }, { status: 404 });
  }

  await deleteLocalSession(request.headers.get("cookie"));
  return new Response(null, {
    status: 303,
    headers: {
      location: "/login",
      "set-cookie": clearSessionCookie(request),
    },
  });
}
