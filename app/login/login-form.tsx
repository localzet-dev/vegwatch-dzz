"use client";

import { FormEvent, useState } from "react";
import { Leaf, LoaderCircle, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось войти");
      window.location.assign(returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось войти");
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-mark"><Leaf /></span><span><strong>VegWatch ДЗЗ</strong><small>Автономный контур</small></span></div>
        <div className="login-copy">
          <span className="login-lock"><LockKeyhole /></span>
          <h1 id="login-title">Вход в систему</h1>
          <p>Доступ к данным ДЗЗ, результатам анализа и управлению командой.</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="login-email">Email</label>
          <Input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="login-password">Пароль</label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <Button type="submit" className="mt-2 h-11 w-full bg-lime-400 text-[#0a1714] hover:bg-lime-300" disabled={loading}>
            {loading ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
            {loading ? "Проверяем…" : "Войти"}
          </Button>
          {message && <p className="login-error" role="alert">{message}</p>}
        </form>
        <p className="login-footnote">Первый администратор задаётся переменными окружения контейнера.</p>
      </section>
    </main>
  );
}
