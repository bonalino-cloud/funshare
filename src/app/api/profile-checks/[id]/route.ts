import type { NextRequest } from "next/server";
import { defaultReadDeps, getProfileCheck } from "@/server/profile-check";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getProfileCheck(request, id, defaultReadDeps());
}
