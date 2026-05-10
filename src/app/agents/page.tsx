"use client";
import { useState } from "react";
import { Card, PageHeader, Button, Badge } from "@/components/ui";
import { agents as initialAgents } from "@/lib/mock/data";

export default function AgentsPage() {
  const [agents, setAgents] = useState(initialAgents);
  const [running, setRunning] = useState<string | null>(null);
  function runAgent(id: string) {
    setRunning(id);
    setTimeout(() => {
      setAgents((current) => current.map((a) => a.id === id ? { ...a, status: "Completed", lastRun: "Just now", output: `${a.name} completed a demo analysis and produced an actionable recommendation.` } : a));
      setRunning(null);
    }, 700);
  }
  return <><PageHeader title="AI Agent Center" description="Run specialized SEO agents. Phase 1 simulates outputs; Phase 2 connects these agents to OpenAI and Google data." />
  <div className="grid gap-5 lg:grid-cols-2">{agents.map((agent) => <Card key={agent.id}><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-ink">{agent.name}</h2><p className="mt-2 text-sm text-muted-foreground">{agent.role}</p></div><Badge variant={agent.status === "Completed" ? "default" : "muted"}>{agent.status}</Badge></div><div className="mt-5 rounded-2xl bg-cream p-4"><p className="text-sm font-semibold text-ink">Output summary</p><p className="mt-2 text-sm text-muted-foreground">{agent.output}</p><p className="mt-2 text-xs text-muted-foreground">Last run: {agent.lastRun}</p></div><Button disabled={running === agent.id} onClick={() => runAgent(agent.id)} className="mt-5">{running === agent.id ? "Running..." : "Run Agent"}</Button></Card>)}</div></>;
}
