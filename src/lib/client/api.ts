import type { z } from "zod";
import {
  Artifact,
  CandidatesResponse,
  ErrorCode,
  GenerationCreated,
  GenerationRequest,
  GenerationStatus,
  Pricing,
  ProfileCheckCreated,
  ProfileCheckRequest,
  ProfileCheckStatus,
  Quote,
  QuoteRequest,
  SelectionRequest,
} from "@/contracts";
import { mockApi } from "./mocks";

/**
 * Единственная точка, через которую FE ходит в API (architecture/contracts.md).
 * При NEXT_PUBLIC_USE_MOCKS=1 отдаёт фикстуры из src/contracts/fixtures и проигрывает статусы с задержками.
 * Любой ответ проходит zod-схему; ошибка API превращается в ApiError с человеческим errorCode.
 */

export class ApiError extends Error {
  constructor(
    public readonly errorCode: ErrorCode,
    public readonly status = 0,
  ) {
    super(errorCode);
    this.name = "ApiError";
  }
}

/** Любая ошибка → код для экрана. Незнакомое — `internal`, подробности только в консоль. */
export function toErrorCode(error: unknown): ErrorCode {
  if (error instanceof ApiError) return error.errorCode;
  console.error(error);
  return "internal";
}

export interface Api {
  createProfileCheck(req: ProfileCheckRequest): Promise<ProfileCheckCreated>;
  getProfileCheck(id: string): Promise<ProfileCheckStatus>;
  getPricing(): Promise<Pricing>;
  createQuote(req: QuoteRequest): Promise<Quote>;
  createGeneration(req: GenerationRequest): Promise<GenerationCreated>;
  getGeneration(id: string): Promise<GenerationStatus>;
  getCandidates(generationId: string): Promise<CandidatesResponse>;
  submitSelection(generationId: string, req: SelectionRequest): Promise<void>;
  getArtifact(slug: string): Promise<Artifact>;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.ok) return res;
  const body: unknown = await res.json().catch(() => null);
  const raw =
    typeof body === "object" && body !== null && "errorCode" in body ? body.errorCode : undefined;
  const code = ErrorCode.safeParse(raw);
  throw new ApiError(code.success ? code.data : "internal", res.status);
}

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: RequestInit,
): Promise<z.output<S>> {
  const res = await send(path, init);
  return schema.parse(await res.json());
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const id = encodeURIComponent;

const realApi: Api = {
  createProfileCheck: (req) =>
    request(ProfileCheckCreated, "/api/profile-checks", post(ProfileCheckRequest.parse(req))),
  getProfileCheck: (checkId) => request(ProfileCheckStatus, `/api/profile-checks/${id(checkId)}`),
  getPricing: () => request(Pricing, "/api/pricing"),
  createQuote: (req) => request(Quote, "/api/quotes", post(QuoteRequest.parse(req))),
  createGeneration: (req) =>
    request(GenerationCreated, "/api/generations", post(GenerationRequest.parse(req))),
  getGeneration: (genId) => request(GenerationStatus, `/api/generations/${id(genId)}`),
  getCandidates: (genId) => request(CandidatesResponse, `/api/generations/${id(genId)}/candidates`),
  submitSelection: async (genId, req) => {
    await send(`/api/generations/${id(genId)}/selection`, post(SelectionRequest.parse(req)));
  },
  getArtifact: (slug) => request(Artifact, `/api/artifacts/${id(slug)}`),
};

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "1";

export const api: Api = USE_MOCKS ? mockApi : realApi;
