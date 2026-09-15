import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SynapseQuest — Bionic Recall Engine",
  description: "知識をつなぎ、描き、思い出す。オフライン対応のネオン知識マップ。",
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
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
