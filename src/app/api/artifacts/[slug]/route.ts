import type { NextRequest } from "next/server";
import { defaultArtifactReadDeps, getArtifactResponse } from "@/server/artifacts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return getArtifactResponse(request, slug, defaultArtifactReadDeps());
}
