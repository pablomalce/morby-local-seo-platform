/**
 * Backward-compat orchestrator.
 *
 * The original agent runner has been replaced by the scope-aware registry. This shim preserves
 * the public surface used by older API routes (`runAgent(id)` / `runAllAgents()`) while routing
 * everything through the new registry so the platform always speaks one language.
 */

import { businesses } from "@/lib/mock/universal";
import { getAgent, runAgent as runAgentScoped, runAllAgents as runAllScoped } from "./registry";

export async function runAgent(agentId: string) {
  const definition = getAgent(agentId);
  if (!definition) throw new Error("Agent not found");
  // Default scope: the first business in the demo dataset.
  const scopeId = businesses[0].id;
  return runAgentScoped({ agentId, scope: "business", scopeId });
}

export async function runAllAgents() {
  return runAllScoped({ scope: "business", scopeId: businesses[0].id });
}

export { listAgents } from "./registry";
