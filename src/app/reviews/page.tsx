import { Card, PageHeader, Badge } from "@/components/ui";
import { reviews } from "@/lib/mock/data";

export default function ReviewsPage() {
  const facial = reviews.filter((r) => r.service === "ansiktsbehandling").length;
  return <><PageHeader title="Reviews Strategy" description="Track review quality, service mentions and suggested Swedish replies for stronger local entity signals." action={<Badge variant="gold">{facial} facial demo mention</Badge>} />
  <div className="grid gap-5 lg:grid-cols-3"><Card><p className="text-sm text-muted-foreground">Total demo reviews</p><p className="mt-2 text-4xl font-bold text-ink">{reviews.length}</p></Card><Card><p className="text-sm text-muted-foreground">Mentions ansiktsbehandling</p><p className="mt-2 text-4xl font-bold text-ink">{facial}</p></Card><Card><p className="text-sm text-muted-foreground">Goal</p><p className="mt-2 text-4xl font-bold text-ink">35+</p></Card></div>
  <div className="mt-6 space-y-4">{reviews.map((r) => <Card key={r.author}><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h2 className="font-bold text-ink">{r.author}</h2><p className="mt-1 text-sm text-muted-foreground">{r.rating} stars · {r.service}</p><p className="mt-3 text-ink">“{r.text}”</p></div><Badge>{r.service}</Badge></div><div className="mt-4 rounded-2xl bg-cream p-4"><p className="text-sm font-semibold text-ink">Suggested Swedish reply</p><p className="mt-2 text-sm text-muted-foreground">{r.suggestedReply}</p></div></Card>)}</div>
  <Card className="mt-6"><h2 className="text-xl font-bold text-ink">Review request message</h2><p className="mt-3 text-muted-foreground">Tack för ditt besök hos Mörby Fotvård och Skönhet. Om du uppskattade din ansiktsbehandling i Danderyd skulle det betyda mycket om du vill dela din upplevelse på Google.</p></Card></>;
}
