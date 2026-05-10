export const config = {
  appMode: process.env.NEXT_PUBLIC_APP_MODE || "demo",
  isDemoMode: process.env.NEXT_PUBLIC_APP_MODE !== "live"
};
