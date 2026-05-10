"use client";
import { Card, PageHeader, Button, Badge } from "@/components/ui";
import { useState } from "react";

export default function ReportsPage() {
  const [message, setMessage] = useState("");
  const reports = ["Weekly SEO Progress Report", "Monthly Client Executive Report", "Technical SEO Opportunity Report"];
  return <><PageHeader title="Reports" description="Prepare professional client-ready reports. Export buttons are placeholders in Phase 1." />
  <div className="grid gap-5 lg:grid-cols-3">{reports.map((r) => <Card key={r}><Badge variant="gold">Preview</Badge><h2 className="mt-3 text-xl font-bold text-ink">{r}</h2><p className="mt-2 text-sm text-muted-foreground">Includes rankings, GBP actions, review progress, completed tasks and next-week priorities.</p><div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => setMessage(`${r}: PDF export will be implemented in Phase 2.`)}>PDF</Button><Button className="bg-sage" onClick={() => setMessage(`${r}: DOCX export will be implemented in Phase 2.`)}>DOCX</Button><Button className="bg-gold text-ink" onClick={() => setMessage(`${r}: CSV export will be implemented in Phase 2.`)}>CSV</Button></div></Card>)}</div>{message && <Card className="mt-6"><p className="font-semibold text-ink">{message}</p></Card>}</>;
}
