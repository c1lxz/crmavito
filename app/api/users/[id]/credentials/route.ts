import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { issueUserCredentials } from "@/lib/users/credentials";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const result = await issueUserCredentials(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось выдать доступ" },
      { status: 400 },
    );
  }
}
