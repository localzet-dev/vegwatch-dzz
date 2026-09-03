import { redirect } from "next/navigation";

import { chatGPTSignInPath, getChatGPTUser, safeRelativeReturnPath } from "@/app/chatgpt-auth";
import LoginForm from "@/app/login/login-form";
import { isLocalAuthEnabled } from "@/lib/local-auth";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const requestedReturnTo = Array.isArray(params.return_to) ? params.return_to[0] : params.return_to;
  const returnTo = safeRelativeReturnPath(requestedReturnTo ?? "/");

  if (!isLocalAuthEnabled()) redirect(chatGPTSignInPath(returnTo));
  if (await getChatGPTUser()) redirect(returnTo);

  return <LoginForm returnTo={returnTo} />;
}
