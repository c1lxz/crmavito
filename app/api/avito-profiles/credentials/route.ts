import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listAvitoProfilesWithCredentials } from "@/lib/avito/profile-store";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const profiles = await listAvitoProfilesWithCredentials();
  return NextResponse.json({ profiles });
}
