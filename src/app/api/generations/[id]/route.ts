import type { NextRequest } from "next/server";
import { defaultReadDeps, getGeneration } from "@/server/generations";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getGeneration(request, id, defaultReadDeps());
}
