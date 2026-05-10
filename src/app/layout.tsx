import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout";

export const metadata: Metadata = {
  title: "Mörby Local SEO Intelligence Platform",
  description: "AI-powered local SEO dashboard for Mörby Fotvård och Skönhet.",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = { themeColor: "#8FAF9A" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
