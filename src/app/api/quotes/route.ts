import type { NextRequest } from "next/server";
import { defaultDeps, postQuote } from "@/server/orders";

export async function POST(request: NextRequest) {
  return postQuote(request, defaultDeps());
}
