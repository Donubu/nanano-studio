import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ChangelogRow extends RowDataPacket {
    id: number;
    version: string;
    title: string;
    content: string;
    image_url: string | null;
    published_at: Date;
}

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [rows] = await pool.query<ChangelogRow[]>(
        `SELECT c.* FROM changelogs c
         WHERE c.id NOT IN (
             SELECT changelog_id FROM user_changelog_seen WHERE user_id = ?
         )
         ORDER BY c.published_at DESC
         LIMIT 1`,
        [session.user.id]
    );

    return NextResponse.json({ changelog: rows[0] || null });
}
