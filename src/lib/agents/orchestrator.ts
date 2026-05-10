import { agents } from "@/lib/mock/data";

export async function runAgent(agentId: string) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Agent not found");
  return {
    ...agent,
    status: "Completed",
    lastRun: new Date().toISOString(),
    output: `${agent.name} produced a demo recommendation for Mörby Fotvård och Skönhet.`
  };
}

export async function runAllAgents() {
  return Promise.all(agents.map((a) => runAgent(a.id)));
}
