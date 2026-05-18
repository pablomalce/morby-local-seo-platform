import type { Config } from "tailwindcss";

/**
 * Vulkan Studios — Tailwind configuration
 *
 * Tokens map 1:1 to the UI Kit (slide 04 — Chromatic System, slide 13 — Implementation).
 * Rules carried in code:
 *   • Vulkan Black is the canvas. Orange is a tool of contrast, NEVER wallpaper.
 *   • Borders thin, edges sharp. 4px button radius, 8px card radius. Nothing rounder.
 *   • Pattern is texture, not decoration — capped at 10% opacity, never behind long text.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens
        vulkan: {
          black: "#000000",
          orange: "#EF4C24",
          "orange-soft": "#F56A44",
          "orange-dark": "#BF3A18",
          white: "#F5F5F5",
        },
        // Greyscale / hierarchy / borders / cards / aux text
        metal: {
          950: "#050505",
          900: "#0A0A0A",
          800: "#111111",
          700: "#1A1A1A",
          600: "#2A2A2A",
          500: "#666666",
          400: "#8A8A8A",
          300: "#B5B5B5",
          200: "#D4D4D4",
        },
        // Semantic aliases (kept thin so utility classes read naturally across the app)
        background: "#000000",
        foreground: "#F5F5F5",
        border: "#1A1A1A",
        input: "#050505",
        ring: "#EF4C24",
        card: { DEFAULT: "#0A0A0A", foreground: "#F5F5F5" },
        muted: { DEFAULT: "#111111", foreground: "#8A8A8A" },
        accent: { DEFAULT: "#EF4C24", foreground: "#000000" },
      },
      fontFamily: {
        display: ["var(--font-rajdhani)", "Rajdhani", "sans-serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "monospace"],
        michroma: ["var(--font-michroma)", "Michroma", "sans-serif"],
      },
      letterSpacing: {
        hud: "0.18em",
        display: "-0.01em",
      },
      borderRadius: {
        none: "0",
        vulkan: "4px",
        "vulkan-card": "8px",
      },
      boxShadow: {
        "orange-glow": "0 0 24px rgba(239,76,36,.45)",
        "orange-glow-soft": "0 0 16px rgba(239,76,36,.22)",
        "card-orange": "0 20px 60px rgba(0,0,0,.55), 0 0 32px rgba(239,76,36,.12)",
        "card-deep": "0 16px 48px rgba(0,0,0,.45)",
        hairline: "inset 0 -1px 0 rgba(255,255,255,.04)",
      },
      backgroundImage: {
        "vulkan-pattern": "url('/patterns/vulkan-pattern.svg')",
        "vulkan-radial":
          "radial-gradient(circle at 70% 30%, rgba(239,76,36,.18), transparent 32%)",
        "vulkan-radial-soft":
          "radial-gradient(circle at 80% 0%, rgba(239,76,36,.10), transparent 40%)",
      },
      transitionTimingFunction: {
        vulkan: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      transitionDuration: {
        vulkan: "150ms",
        "vulkan-card": "220ms",
      },
      keyframes: {
        "vulkan-glitch": {
          "0%": { transform: "translate(0)" },
          "40%": { transform: "translate(2px,-1px)" },
          "100%": { transform: "translate(0)" },
        },
        "vulkan-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "vulkan-reveal": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "vulkan-glitch": "vulkan-glitch 420ms steps(2,end)",
        "vulkan-pulse": "vulkan-pulse 1600ms ease-in-out infinite",
        "vulkan-reveal": "vulkan-reveal 320ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
