import type { NextRequest } from "next/server";
import { defaultSelectionDeps, getCandidates } from "@/server/generations";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getCandidates(request, id, defaultSelectionDeps());
}
