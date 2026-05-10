import { Card, PageHeader, Badge, Progress } from "@/components/ui";
import { gbpChecklist } from "@/lib/mock/data";
import { Camera, MapPin, MessageSquare, Newspaper } from "lucide-react";

export default function GBPPage() {
  const ideas = [
    { icon: Newspaper, title: "Weekly post", text: "Publicera ett inlägg om ansiktsbehandling i Danderyd varje vecka." },
    { icon: Camera, title: "Photo signal", text: "Ladda upp bilder på behandlingsrum, produkter och hudvårdsmiljö." },
    { icon: MessageSquare, title: "Review signal", text: "Be kunder nämna sin upplevelse av ansiktsbehandling naturligt." },
    { icon: MapPin, title: "Local clarity", text: "Förstärk Mörby/Danderyd i profilens servicebeskrivningar." }
  ];
  return <><PageHeader title="Google Business Profile Optimization" description="Manual GBP optimization cockpit. Phase 2 can connect this to real Google Business Profile data with OAuth." action={<Badge>Audit score 72%</Badge>} />
  <div className="grid gap-6 xl:grid-cols-3"><Card className="xl:col-span-2"><h2 className="text-xl font-bold text-ink">Optimization checklist</h2><div className="mt-5 space-y-3">{gbpChecklist.map((item) => <div key={item.item} className="flex items-center justify-between rounded-2xl border bg-white p-4"><span className="font-medium text-ink">{item.item}</span><Badge variant={item.status === "Pending" ? "muted" : "gold"}>{item.status}</Badge></div>)}</div></Card><Card><h2 className="text-xl font-bold text-ink">Profile score</h2><p className="mt-2 text-sm text-muted-foreground">Current demo estimate based on category relevance, services, reviews, photos and posting consistency.</p><div className="mt-6"><Progress value={72} /></div><p className="mt-3 text-4xl font-bold text-ink">72%</p><p className="mt-2 text-sm text-muted-foreground">Target: 90%+ within 60 days.</p></Card></div>
  <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">{ideas.map((idea) => { const Icon = idea.icon; return <Card key={idea.title}><Icon className="mb-4 h-6 w-6 text-sage" /><h3 className="font-bold text-ink">{idea.title}</h3><p className="mt-2 text-sm text-muted-foreground">{idea.text}</p></Card>; })}</div></>;
}
