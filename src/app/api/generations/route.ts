import type { NextRequest } from "next/server";
import { createGeneration, defaultDeps } from "@/server/generations";

export async function POST(request: NextRequest) {
  return createGeneration(request, defaultDeps());
}
