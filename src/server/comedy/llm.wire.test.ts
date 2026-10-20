import { afterEach, expect, it, vi } from "vitest";
import {
  COMEDY_ROLES,
  comedyRoleConfig,
  createComedyGenerate,
  HAIKU_MODEL,
  SONNET_MODEL,
} from "./llm";

// Тело запроса к Anthropic, как его собирает настоящий AI SDK (сеть подменена). Правила API на
// 2026-10 (иначе 400): Sonnet 5.5 не принимает `disabled`, его минимум `between_tools` — без
// других полей в `thinking` и при effort не выше high; Haiku 5.5 `between_tools` не принимает,
// `disabled` — при effort не выше high. Принудительный `tool_choice` и сэмплинг (`temperature`,
// `top_p`, `top_k`) обе модели отклоняют: JSON идёт через `output_config.format`.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Body = {
  model: string;
  thinking?: { type: string } & Record<string, unknown>;
  output_config?: { effort?: string; format?: { type: string } };
} & Record<string, unknown>;

const LOW_EFFORTS = ["low", "medium", "high"];
const ALLOWED: Record<string, readonly string[]> = {
  [SONNET_MODEL]: ["between_tools", "adaptive"],
  [HAIKU_MODEL]: ["disabled", "adaptive"],
};

async function sentBody(role: (typeof COMEDY_ROLES)[number]): Promise<Body> {
  let body: Body | undefined;
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Body;
    const answer = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: "{}" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  await createComedyGenerate(role)({ system: "s", parts: [{ type: "text", text: "u" }] });
  if (!body) throw new Error("запрос не ушёл");
  return body;
}

it("каждая роль шлёт допустимую для своей модели связку thinking и effort", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  for (const role of COMEDY_ROLES) {
    const body = await sentBody(role);
    const type = body.thinking?.type;
    const effort = body.output_config?.effort;
    expect(body.model, role).toBe(comedyRoleConfig(role).model);
    expect(ALLOWED[body.model], role).toContain(type);
    if (type === "between_tools") expect(Object.keys(body.thinking ?? {}), role).toEqual(["type"]);
    if (type === "between_tools" || type === "disabled")
      expect(LOW_EFFORTS, role).toContain(effort);
    expect(body.output_config?.format?.type, role).toBe("json_schema");
    for (const key of ["tool_choice", "tools", "temperature", "top_p", "top_k"]) {
      expect(body, `${role}: ${key}`).not.toHaveProperty(key);
    }
  }
});
