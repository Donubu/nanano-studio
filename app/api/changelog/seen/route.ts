import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { changelogId } = await request.json();
    if (!changelogId) {
        return NextResponse.json({ error: "Missing changelogId" }, { status: 400 });
    }

    await pool.query(
        `INSERT IGNORE INTO user_changelog_seen (user_id, changelog_id) VALUES (?, ?)`,
        [session.user.id, changelogId]
    );

    return NextResponse.json({ ok: true });
}
