import {
  Artifact,
  CandidatesResponse,
  ErrorCode,
  GenerationRequest,
  Pricing,
  ProfileCheckStatus,
  Quote,
  SelectionRequest,
  type GenerationStatus,
  type ProfileCheckRequest,
  type QuoteRequest,
  type TierInfo,
} from "@/contracts";
import artifactRoast from "@/contracts/fixtures/artifact-roast.json";
import candidates20 from "@/contracts/fixtures/candidates-20.json";
import pricingFixture from "@/contracts/fixtures/pricing.json";
import profileCheckOk from "@/contracts/fixtures/profile-check-ok.json";
import { ApiError, type Api } from "./api";
import { parseInstagramInput } from "./instagram";

/**
 * Мок API на фикстурах. Статусы проигрываются по времени с момента запроса (STEP_MS на шаг),
 * генерация останавливается на awaiting_selection, пока не придёт выбор.
 *
 * Спецники для ошибок проверки профиля: private, nobody, empty, kid, broken.
 * Волшебные слова: ПОГНАЛИ100 (−100 %), ПОЛОВИНА (−50 %).
 */

const STEP_MS = 1800;
const PRICING = Pricing.parse(pricingFixture);
const CANDIDATES = CandidatesResponse.parse(candidates20);
const ARTIFACT = Artifact.parse(artifactRoast);
const CHECK_OK = profileCheckOk.map((s) => ProfileCheckStatus.parse(s));
const PROMOS: Record<string, number> = { ПОГНАЛИ100: 100, FREEE: 100, ПОЛОВИНА: 50 };
const FAIL_BY_USERNAME: Record<string, ErrorCode> = {
  private: "profile_private",
  nobody: "profile_not_found",
  empty: "not_enough_data",
  kid: "minor_detected",
  broken: "internal",
};

type Check = { username: string; startedAt: number; fail?: ErrorCode };
type Gen = {
  req: GenerationRequest;
  tier: TierInfo;
  username: string;
  slug: string;
  startedAt: number;
  selectedAt?: number;
  punchIds?: string[];
};

/**
 * Память мока переживает перезагрузку страницы: лежит в sessionStorage, как и черновик.
 * Иначе после F5 на шаге 5 проверка профиля «теряется», и генерация падает.
 */
const STORE_KEY = "funshare.mock.v1";
type Store = {
  checks: [string, Check][];
  gens: [string, Gen][];
  seq: number;
  freeTrialUsed: boolean;
};

function loadStore(): Store {
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(STORE_KEY) : null;
    if (raw) return JSON.parse(raw) as Store;
  } catch {}
  return { checks: [], gens: [], seq: 0, freeTrialUsed: false };
}

const store = loadStore();
const checks = new Map<string, Check>(store.checks);
const gens = new Map<string, Gen>(store.gens);
let seq = store.seq;
let freeTrialUsed = store.freeTrialUsed;

function persist() {
  try {
    const next: Store = { checks: [...checks], gens: [...gens], seq, freeTrialUsed };
    sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {}
}

const nextId = (prefix: string) => `${prefix}_mock_${String(++seq).padStart(2, "0")}`;
const iso = () => new Date().toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tierInfo = (tier: number) => {
  const t = PRICING.tiers.find((x) => x.tier === tier);
  if (!t) throw new ApiError("internal", 500);
  return t;
};

function quoteFor({ tier, promoCode }: QuoteRequest): Quote {
  const t = tierInfo(tier);
  const base = { tier: t.tier, listAmount: t.listAmount, currency: t.currency } as const;
  if (promoCode !== undefined) {
    const pct = PROMOS[promoCode.trim().toUpperCase()];
    if (pct === undefined) throw new ApiError("promo_invalid", 400);
    const discountAmount = Math.round((t.listAmount * pct) / 100);
    return Quote.parse({
      ...base,
      discountAmount,
      finalAmount: t.listAmount - discountAmount,
      promo: { code: promoCode.trim().toUpperCase(), percentOff: pct },
    });
  }
  if (t.tier === 1 && !freeTrialUsed) {
    return Quote.parse({ ...base, discountAmount: t.listAmount, finalAmount: 0, freeTrial: true });
  }
  return Quote.parse({ ...base, discountAmount: 0, finalAmount: t.listAmount });
}

function generationStatus(genId: string, g: Gen): GenerationStatus {
  const base = { id: genId, updatedAt: iso() };
  const elapsed = Date.now() - g.startedAt;
  if (elapsed < STEP_MS * 0.5) return { ...base, status: "queued" };
  if (elapsed < STEP_MS * 3) {
    const hint = elapsed < STEP_MS * 1.8 ? "Считаем закаты… 47" : "Точим панчи…";
    return { ...base, status: "writing", hint };
  }
  if (g.selectedAt === undefined) return { ...base, status: "awaiting_selection" };
  const since = Date.now() - g.selectedAt;
  const drawMs = g.tier.imageCount === 0 ? 600 : STEP_MS * 2;
  if (since < drawMs) {
    const done = Math.min(g.tier.imageCount, Math.floor((since / drawMs) * g.tier.imageCount) + 1);
    return {
      ...base,
      status: "drawing",
      hint: g.tier.imageCount ? `${done} из ${g.tier.imageCount}` : undefined,
    };
  }
  return { ...base, status: "ready", artifactSlug: g.slug };
}

/** Клетки public/mocks/roast/1–6.webp: цвет фона — медиана верхнего края клетки. */
const MOCK_CELLS = [
  { bg: "#fff6b8", alt: "Бородач в кепке у мольбертов, рядом сердитая какашка с табличкой" },
  { bg: "#f8ceda", alt: "Бородач в смокинге с кольцом на скамейке «Запасной аэродром»" },
  { bg: "#cff0ff", alt: "Бородач в пижаме смотрит в телефон с подписью «Это ты»" },
  { bg: "#d1f7c4", alt: "Бородач нюхает носок, рядом вянет кактус" },
  { bg: "#fae5d0", alt: "Бородач падает со сцены, уронив микрофон и кепку" },
  { bg: "#ccfde6", alt: "Бородач едет в самосвале, полном бумаг" },
] as const;
export const mockApi: Api = {
  async createProfileCheck(req: ProfileCheckRequest) {
    await wait(300);
    const username = parseInstagramInput(req.instagramUrl);
    if (!username) throw new ApiError("invalid_url", 400);
    const checkId = nextId("chk");
    checks.set(checkId, { username, startedAt: Date.now(), fail: FAIL_BY_USERNAME[username] });
    persist();
    return { id: checkId };
  },

  async getProfileCheck(checkId) {
    await wait(150);
    const c = checks.get(checkId);
    if (!c) throw new ApiError("internal", 404);
    const idx = Math.min(Math.floor((Date.now() - c.startedAt) / STEP_MS), CHECK_OK.length - 1);
    const base = { id: checkId, updatedAt: iso() };
    if (c.fail && idx >= 2) return { ...base, status: "failed", errorCode: c.fail };
    if (idx < CHECK_OK.length - 1)
      return { ...base, status: "checking", hint: CHECK_OK[idx]?.hint };
    const ok = CHECK_OK.at(-1)?.profile;
    if (!ok) throw new ApiError("internal", 500);
    return {
      ...base,
      status: "ok",
      profile: {
        ...ok,
        username: c.username,
        avatarUrl: `https://placehold.co/320x320.png?text=${encodeURIComponent(c.username[0]?.toUpperCase() ?? "?")}`,
      },
    };
  },

  async getPricing() {
    await wait(200);
    return { ...PRICING, freeTrialAvailable: !freeTrialUsed };
  },

  async createQuote(req) {
    await wait(300);
    return quoteFor(req);
  },

  async createGeneration(raw) {
    await wait(400);
    const req = GenerationRequest.parse(raw);
    const check = checks.get(req.profileCheckId);
    if (!check) throw new ApiError("internal", 404);
    const quote = quoteFor({ tier: req.tier, promoCode: req.promoCode });
    if (quote.finalAmount > 0) throw new ApiError("payment_required", 402);
    if (quote.freeTrial) freeTrialUsed = true;
    const genId = nextId("gen");
    gens.set(genId, {
      req,
      tier: tierInfo(req.tier),
      username: check.username,
      slug: `m${genId.replace(/\D/g, "")}`.padEnd(10, "x").slice(0, 10),
      startedAt: Date.now(),
    });
    persist();
    return { id: genId };
  },

  async getGeneration(genId) {
    await wait(150);
    const g = gens.get(genId);
    if (!g) throw new ApiError("internal", 404);
    return generationStatus(genId, g);
  },

  async getCandidates(genId) {
    await wait(200);
    const g = gens.get(genId);
    if (!g) throw new ApiError("internal", 404);
    return CandidatesResponse.parse({
      generationId: genId,
      selectCount: g.tier.selectCount,
      candidates: CANDIDATES.candidates.slice(0, g.tier.candidateCount),
    });
  },

  async submitSelection(genId, raw) {
    await wait(300);
    const g = gens.get(genId);
    if (!g) throw new ApiError("internal", 404);
    const { punchIds } = SelectionRequest.parse(raw);
    const known = new Set(CANDIDATES.candidates.slice(0, g.tier.candidateCount).map((p) => p.id));
    if (punchIds.length !== g.tier.selectCount || !punchIds.every((p) => known.has(p))) {
      throw new ApiError("internal", 400);
    }
    g.punchIds = punchIds;
    g.selectedAt = Date.now();
    persist();
  },

  async getArtifact(slug) {
    await wait(200);
    const entry = [...gens.entries()].find(([, g]) => g.slug === slug);
    if (!entry) throw new ApiError("internal", 404);
    const [genId, g] = entry;
    if (generationStatus(genId, g).status !== "ready" || !g.punchIds) {
      throw new ApiError("internal", 404);
    }
    const byId = new Map(CANDIDATES.candidates.map((p) => [p.id, p]));
    return Artifact.parse({
      ...ARTIFACT,
      slug,
      mode: g.req.mode,
      subject: { ...ARTIFACT.subject, username: g.username },
      content: {
        ...ARTIFACT.content,
        title: `Прожарка @${g.username}`,
        punches: g.punchIds.map((p) => byId.get(p)),
      },
      images: [],
      // Клетки референсного холста 2×3, нарезанные как в шаге draw (roast-engine §7.0)
      punchImages: g.punchIds.slice(0, g.tier.imageCount).map((punchId, i) => ({
        punchId,
        url: new URL(`/mocks/roast/${(i % MOCK_CELLS.length) + 1}.webp`, location.origin).href,
        alt: MOCK_CELLS[i % MOCK_CELLS.length]?.alt ?? "Картинка к шутке",
        bg: MOCK_CELLS[i % MOCK_CELLS.length]?.bg ?? "#fff7b5",
      })),
      isOwner: true,
    });
  },
};
