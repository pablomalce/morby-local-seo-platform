import { contentIdeas } from "@/lib/mock/data";

export async function generateSeoContent(topic: string) {
  if (!process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_APP_MODE !== "live") {
    return { mode: "demo", topic, content: contentIdeas };
  }
  // Phase 2: connect OpenAI Responses API here using OPENAI_API_KEY.
  return { mode: "live-placeholder", topic, content: contentIdeas };
}
