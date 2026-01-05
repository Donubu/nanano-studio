import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ChatInterface } from "@/components/chat/chat-interface";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return <ChatInterface />;
}
