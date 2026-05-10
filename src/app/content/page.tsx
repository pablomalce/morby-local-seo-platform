"use client";
import { useState } from "react";
import { Card, PageHeader, Button, Badge } from "@/components/ui";
import { contentIdeas } from "@/lib/mock/data";

export default function ContentPage() {
  const [generated, setGenerated] = useState(contentIdeas);
  function generate() { setGenerated([...contentIdeas, { type: "CTA", text: "Boka din ansiktsbehandling i Danderyd idag och låt oss hjälpa din hud att kännas fräschare, lugnare och mer balanserad." }]); }
  return <><PageHeader title="SEO Content Studio" description="Generate Swedish SEO content for service pages, FAQs, meta tags and Google Business Profile posts." action={<Button onClick={generate}>Generate demo content</Button>} />
  <Card><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold text-ink">Generated Swedish SEO assets</h2><Badge>Mock AI output</Badge></div><div className="grid gap-4 md:grid-cols-2">{generated.map((item, idx) => <div key={`${item.type}-${idx}`} className="rounded-2xl border bg-white p-4"><Badge variant="gold">{item.type}</Badge><p className="mt-3 text-ink">{item.text}</p></div>)}</div></Card>
  <Card className="mt-6"><h2 className="text-xl font-bold text-ink">Semantic keyword cluster</h2><div className="mt-4 flex flex-wrap gap-2">{["ansiktsbehandling danderyd", "hudvård danderyd", "ansiktsvård", "professionell hudvård", "Mörby", "skönhetsbehandling", "facial treatments"].map((k) => <Badge key={k}>{k}</Badge>)}</div></Card></>;
}
