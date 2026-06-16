import Link from "next/link";
import { VulkanLogo } from "@/components/ui";
import { Footer } from "@/components/Footer";
import { CookieConsent } from "@/components/CookieConsent";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-vulkan-black vulkan-radial-bg">
      <header className="border-b border-metal-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-3">
            <VulkanLogo size={24} />
            <span className="font-mono text-[10px] uppercase tracking-hud text-metal-400">
              VULKAN <span className="text-vulkan-orange">//</span> GROWTH OS
            </span>
          </Link>
          <nav className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-hud">
            <Link href="/legal/privacy" className="text-metal-400 hover:text-vulkan-white">
              Privacy
            </Link>
            <Link href="/legal/cookies" className="text-metal-400 hover:text-vulkan-white">
              Cookies
            </Link>
            <Link href="/legal/terms" className="text-metal-400 hover:text-vulkan-white">
              Terms
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10 md:px-8 md:py-16">{children}</main>
      <Footer />
      <CookieConsent />
    </div>
  );
}
