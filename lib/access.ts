import { count, eq, sql } from "drizzle-orm";

import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export type AccessRole = "admin" | "analyst" | "viewer";

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  role: AccessRole;
};

export async function getOrCreateProfile(user: ChatGPTUser): Promise<UserProfile> {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        email: user.email,
        displayName: user.displayName,
        lastSeenAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, user.id))
      .returning();
    return updated as UserProfile;
  }

  // A new Site is owner-only. The first authenticated visitor safely becomes
  // the bootstrap administrator; users added after sharing start as viewers.
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const role: AccessRole = userCount === 0 ? "admin" : "viewer";
  const [created] = await db
    .insert(users)
    .values({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role,
    })
    .returning();
  return created as UserProfile;
}

export async function getRequestProfile(): Promise<UserProfile | null> {
  const user = await getChatGPTUser();
  return user ? getOrCreateProfile(user) : null;
}

export function canUpload(role: AccessRole) {
  return role === "admin" || role === "analyst";
}
