import { redirect } from "next/navigation";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { BudgetDetail } from "@/components/calculadora/budget-detail";

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as { id: number }).id;
  const isAdmin = session.user.role === "admin";

  if (!isAdmin) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT ai_calculator_access FROM users WHERE id = ?",
      [userId]
    );
    if (!rows.length || rows[0].ai_calculator_access !== 1) {
      redirect("/");
    }
  }

  const { id } = await params;

  return <BudgetDetail budgetId={id} />;
}
