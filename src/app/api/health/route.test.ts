import { expect, it } from "vitest";
import { GET } from "./route";

it("GET /api/health отвечает ok", async () => {
  const res = GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
