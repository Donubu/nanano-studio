import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ChatInterface } from "@/components/chat/chat-interface";

// Force dynamic rendering for catch-all routes
export const dynamic = "force-dynamic";

// This catch-all route handles virtual navigation URLs like:
// /{project-slug}/
// /{project-slug}/gallery
// /{project-slug}/gallery/{id}
// /{project-slug}/gallery/{id}/topaz
// These routes are managed by the NavigationProvider using the History API

export default async function ProjectPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <ChatInterface />;
}
