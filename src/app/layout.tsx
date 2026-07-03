import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Живі логи",
  description: "Live viewer for Codex/Claude agent logs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk" className="h-full antialiased">
      <body className="h-dvh overflow-hidden font-sans text-[15px]">
        {children}
      </body>
    </html>
  );
}
