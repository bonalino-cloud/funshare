import type { NextRequest } from "next/server";
import { defaultSelectionDeps, postSelection } from "@/server/generations";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return postSelection(request, id, defaultSelectionDeps());
}
