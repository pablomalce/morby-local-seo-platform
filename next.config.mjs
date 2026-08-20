/** @type {import('next').NextConfig} */

// Content-Security-Policy in REPORT-ONLY mode: the browser logs violations to the console but does
// NOT enforce them, so this can never break the UI. It's a permissive starting point (Next.js needs
// 'unsafe-inline'/'unsafe-eval' without a nonce setup) meant for observing what the app actually
// loads before switching to an enforced, nonce-based policy. Tighten, then flip the header name to
// "Content-Security-Policy" to enforce.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.googleapis.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Baseline security headers (safe, enforced). CSP is report-only above — enforcing a CSP needs
// per-app testing and a wrong one silently breaks the UI.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
