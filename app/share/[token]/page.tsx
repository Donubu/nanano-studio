import { notFound } from "next/navigation";
import { SharedGallery } from "@/components/share/shared-gallery";
import { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Puerto Studio - Estudio Compartido",
};

export const dynamic = "force-dynamic";

export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Validate token format
  if (!token || token.length < 20 || token.length > 100) {
    notFound();
  }

  // Fetch initial data server-side
  const baseUrl = process.env.NEXTAUTH_URL || "https://puerto.studio";
  const res = await fetch(`${baseUrl}/api/share/${token}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    notFound();
  }

  const data = await res.json();

  return (
    <div className="min-h-screen bg-background">
      <SharedGallery token={token} initialData={data} />
    </div>
  );
}
