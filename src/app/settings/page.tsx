import { Card, PageHeader, Badge } from "@/components/ui";
import { business } from "@/lib/mock/data";

export default function SettingsPage() {
  const integrations = ["OpenAI API", "Google Places API", "Google Business Profile API", "Google Search Console", "Google Analytics GA4"];
  return <><PageHeader title="Settings & Integration Readiness" description="Project configuration, demo mode and future API connection checklist." action={<Badge variant="gold">Demo mode</Badge>} />
  <div className="grid gap-6 lg:grid-cols-2"><Card><h2 className="text-xl font-bold text-ink">Business information</h2><div className="mt-5 space-y-3 text-sm"><Row label="Business" value={business.name} /><Row label="Website" value={business.website} /><Row label="Location" value={business.location} /><Row label="Target keyword" value={business.targetKeyword} /></div></Card><Card><h2 className="text-xl font-bold text-ink">Integration checklist</h2><div className="mt-5 space-y-3">{integrations.map((i) => <div key={i} className="flex items-center justify-between rounded-2xl border bg-white p-4"><span className="font-medium text-ink">{i}</span><Badge variant="muted">Not connected</Badge></div>)}</div><p className="mt-5 text-sm text-muted-foreground">Do not paste real API keys into frontend fields. Add credentials to .env.local in Phase 2.</p></Card></div></>;
}
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4 rounded-xl bg-cream px-4 py-3"><span className="text-muted-foreground">{label}</span><span className="font-medium text-ink">{value}</span></div>; }
