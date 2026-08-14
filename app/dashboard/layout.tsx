import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Header } from "@/components/dashboard/header";
import { Sidebar } from "@/components/dashboard/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Segunda barrera además del middleware: el dashboard es solo para admins
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
