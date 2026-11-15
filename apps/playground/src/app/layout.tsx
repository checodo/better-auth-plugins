import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./global.css";

export const metadata: Metadata = {
  title: "Playground · better-auth-plugins",
  description: "Try the @checodo better-auth plugins in a real app.",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
      <body className="min-h-screen font-sans">
        <Nav />
        <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
