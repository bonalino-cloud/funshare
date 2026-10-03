import type { NextRequest } from "next/server";
import { defaultDeps, getPricing } from "@/server/orders";

export async function GET(request: NextRequest) {
  return getPricing(request, defaultDeps());
}
