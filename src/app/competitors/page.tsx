import { Card, PageHeader, Badge, Progress } from "@/components/ui";
import { competitors } from "@/lib/mock/data";

export default function CompetitorsPage() {
  return <><PageHeader title="Competitor Intelligence" description="Compare local competitors and identify the clearest paths to beat them for ansiktsbehandling danderyd." />
  <div className="grid gap-5 lg:grid-cols-3">{competitors.map((c) => <Card key={c.name}><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-ink">{c.name}</h2><p className="mt-1 text-sm text-muted-foreground">Rating {c.rating} · {c.reviews} reviews</p></div><Badge variant="gold">Strength {c.strength}%</Badge></div><div className="mt-5 space-y-4"><div><div className="mb-2 flex justify-between text-sm"><span>Local SEO strength</span><span>{c.strength}%</span></div><Progress value={c.strength} /></div><div><div className="mb-2 flex justify-between text-sm"><span>Service relevance</span><span>{c.relevance}%</span></div><Progress value={c.relevance} /></div></div><Section title="Strengths" items={c.strengths} /><Section title="Weaknesses" items={c.weaknesses} /><Section title="Opportunities" items={c.opportunities} /></Card>)}</div></>;
}
function Section({ title, items }: { title: string; items: string[] }) { return <div className="mt-5"><p className="mb-2 text-sm font-semibold text-ink">{title}</p><ul className="space-y-2 text-sm text-muted-foreground">{items.map((i) => <li key={i} className="rounded-xl bg-cream px-3 py-2">{i}</li>)}</ul></div>; }
