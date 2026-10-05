import { afterEach, describe, expect, it, vi } from "vitest";
import { recallStartedAt } from "./history";

const entry = {
  id: "g1",
  username: "nasa",
  tier: 1,
  level: "rare",
  mode: "self",
  createdAt: "2026-10-05T12:00:00.000Z",
};

function stubStorage(raw: string | null) {
  vi.stubGlobal("localStorage", { getItem: () => raw });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recallStartedAt", () => {
  it("отдаёт момент запуска генерации в миллисекундах", () => {
    stubStorage(JSON.stringify([entry]));
    expect(recallStartedAt("g1")).toBe(Date.parse(entry.createdAt));
  });

  it("неизвестный id — undefined", () => {
    stubStorage(JSON.stringify([{ ...entry, id: "g2" }]));
    expect(recallStartedAt("g1")).toBeUndefined();
  });

  it("истории нет (приватный режим) — undefined", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(recallStartedAt("g1")).toBeUndefined();
  });
});
