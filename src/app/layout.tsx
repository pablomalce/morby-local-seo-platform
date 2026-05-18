import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout";
import { Providers } from "@/lib/context/Providers";

export const metadata: Metadata = {
  title: "VULKAN // GROWTH OS — Engineered Local Growth Platform",
  description:
    "Universal AI-powered local growth and marketing intelligence platform. High-end digital production, engineered by Vulkan Studios.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#000000" };

/**
 * Fonts are loaded via `<link>` in the document head so production builds don't depend on
 * Google Fonts being reachable at build time. The font names below match the CSS variables
 * exposed in `globals.css`, which `tailwind.config.ts` consumes (font-display / font-sans /
 * font-mono / font-michroma).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Michroma&family=Rajdhani:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body className="bg-vulkan-black font-sans text-vulkan-white antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
