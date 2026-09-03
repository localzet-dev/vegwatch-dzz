import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VegWatch ДЗЗ — анализ вегетации",
  description:
    "Онлайн-система анализа временных рядов ДЗЗ и выявления аномалий растительности.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
