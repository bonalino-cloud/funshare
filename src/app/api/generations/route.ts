import type { NextRequest } from "next/server";
import { createGeneration, defaultDeps } from "@/server/generations";

// Старт генерации может ждать досье, которое считается в фоне после «Нашли!» (до 200 с), а при сбое
// фона считает его сам. Литерал обязателен (Next читает его статически).
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return createGeneration(request, defaultDeps());
}
