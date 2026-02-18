import { redirect } from "next/navigation";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { CalculadoraView } from "@/components/calculadora/calculadora-view";

export default async function CalculadoraPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as { id: number }).id;

  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT ai_calculator_access FROM users WHERE id = ?",
    [userId]
  );

  if (!rows.length || rows[0].ai_calculator_access !== 1) {
    redirect("/");
  }

  return <CalculadoraView />;
}
