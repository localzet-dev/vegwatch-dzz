import { and, count, eq, gt, lt } from "drizzle-orm";
import { env } from "cloudflare:workers";

import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { authSessions, localCredentials, users } from "@/db/schema";
import type { AccessRole, UserProfile } from "@/lib/access";

export const LOCAL_SESSION_COOKIE = "vegwatch_session";

const PASSWORD_ITERATIONS = 210_000;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const textEncoder = new TextEncoder();

type RuntimeEnv = {
  VEGWATCH_AUTH_MODE?: string;
  VEGWATCH_ADMIN_EMAIL?: string;
  VEGWATCH_ADMIN_PASSWORD?: string;
};

function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function isLocalAuthEnabled() {
  return runtimeEnv().VEGWATCH_AUTH_MODE === "local";
}

export function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function validatePassword(value: string) {
  if (value.length < 12) return "Пароль должен содержать не менее 12 символов";
  if (value.length > 128) return "Пароль не должен быть длиннее 128 символов";
  return null;
}

export async function getLocalAuthenticatedUser(
  requestHeaders: Pick<Headers, "get">,
): Promise<ChatGPTUser | null> {
  if (!isLocalAuthEnabled()) return null;

  const token = readCookie(requestHeaders.get("cookie"), LOCAL_SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const [record] = await getDb()
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now)))
    .limit(1);

  if (!record) return null;
  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    fullName: record.displayName,
  };
}

export async function authenticateLocalUser(
  emailValue: string,
  password: string,
): Promise<UserProfile | null> {
  if (!isLocalAuthEnabled()) return null;

  const email = normalizeEmail(emailValue);
  const db = getDb();
  let [record] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      passwordHash: localCredentials.passwordHash,
      passwordSalt: localCredentials.passwordSalt,
      iterations: localCredentials.iterations,
    })
    .from(users)
    .innerJoin(localCredentials, eq(localCredentials.userId, users.id))
    .where(eq(users.email, email))
    .limit(1);

  if (!record) {
    const [{ value: credentialCount }] = await db
      .select({ value: count() })
      .from(localCredentials);
    const bootstrapEmail = normalizeEmail(runtimeEnv().VEGWATCH_ADMIN_EMAIL ?? "");
    const bootstrapPassword = runtimeEnv().VEGWATCH_ADMIN_PASSWORD ?? "";

    if (
      credentialCount !== 0 ||
      email !== bootstrapEmail ||
      !constantTimeStringEqual(password, bootstrapPassword)
    ) {
      return null;
    }

    const existingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const existingUser = existingUsers[0];
    const userId = existingUser?.id ?? `local:${crypto.randomUUID()}`;
    const displayName = existingUser?.displayName || email.split("@")[0] || "Администратор";
    const credential = await derivePassword(password);

    if (existingUser) {
      await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
    } else {
      await db.insert(users).values({
        id: userId,
        email,
        displayName,
        role: "admin",
      });
    }

    await db.insert(localCredentials).values({
      userId,
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      iterations: credential.iterations,
    });

    record = {
      id: userId,
      email,
      displayName,
      role: "admin",
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      iterations: credential.iterations,
    };
  }

  let valid = await verifyPassword(
    password,
    record.passwordSalt,
    record.iterations,
    record.passwordHash,
  );
  const bootstrapEmail = normalizeEmail(runtimeEnv().VEGWATCH_ADMIN_EMAIL ?? "");
  const bootstrapPassword = runtimeEnv().VEGWATCH_ADMIN_PASSWORD ?? "";
  if (
    !valid &&
    record.email === bootstrapEmail &&
    constantTimeStringEqual(password, bootstrapPassword)
  ) {
    const credential = await derivePassword(password);
    await db
      .update(localCredentials)
      .set({
        passwordHash: credential.hash,
        passwordSalt: credential.salt,
        iterations: credential.iterations,
      })
      .where(eq(localCredentials.userId, record.id));
    valid = true;
  }
  if (!valid) return null;

  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    role: record.role as AccessRole,
  };
}

export async function createLocalUser(input: {
  email: string;
  displayName: string;
  password: string;
  role: AccessRole;
}) {
  if (!isLocalAuthEnabled()) throw new Error("Локальные аккаунты отключены");

  const email = normalizeEmail(input.email);
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) throw new Error("Пользователь с таким email уже существует");

  const id = `local:${crypto.randomUUID()}`;
  const credential = await derivePassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      id,
      email,
      displayName: input.displayName.trim() || email.split("@")[0] || email,
      role: input.role,
    })
    .returning();

  try {
    await db.insert(localCredentials).values({
      userId: id,
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      iterations: credential.iterations,
    });
  } catch (error) {
    await db.delete(users).where(eq(users.id, id));
    throw error;
  }

  return created as UserProfile & { createdAt: string; lastSeenAt: string };
}

export async function createLocalSession(userId: string) {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const db = getDb();

  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date().toISOString()));
  await db.insert(authSessions).values({ tokenHash, userId, expiresAt });
  return { token, expiresAt };
}

export async function deleteLocalSession(cookieHeader: string | null) {
  const token = readCookie(cookieHeader, LOCAL_SESSION_COOKIE);
  if (!token) return;
  await getDb().delete(authSessions).where(eq(authSessions.tokenHash, await sha256(token)));
}

export function sessionCookie(token: string, request: Request) {
  const secure = requestUsesHttps(request) ? "; Secure" : "";
  return `${LOCAL_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = requestUsesHttps(request) ? "; Secure" : "";
  return `${LOCAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function requestUsesHttps(request: Request) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return new URL(request.url).protocol === "https:" || forwardedProtocol === "https";
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

async function derivePassword(password: string) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const hash = await pbkdf2(password, saltBytes, PASSWORD_ITERATIONS);
  return { hash: bytesToBase64Url(hash), salt, iterations: PASSWORD_ITERATIONS };
}

async function verifyPassword(
  password: string,
  salt: string,
  iterations: number,
  expectedHash: string,
) {
  const actual = await pbkdf2(password, base64UrlToBytes(salt), iterations);
  return constantTimeBytesEqual(actual, base64UrlToBytes(expectedHash));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function constantTimeStringEqual(left: string, right: string) {
  return constantTimeBytesEqual(textEncoder.encode(left), textEncoder.encode(right));
}
