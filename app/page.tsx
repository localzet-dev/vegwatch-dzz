import { requireChatGPTUser } from "@/app/chatgpt-auth";
import Dashboard from "@/app/dashboard";
import { getOrCreateProfile } from "@/lib/access";
import { isLocalAuthEnabled } from "@/lib/local-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  const profile = await getOrCreateProfile(user);

  return <Dashboard profile={profile} authMode={isLocalAuthEnabled() ? "local" : "chatgpt"} />;
}
