import { afterEach, describe, expect, it, vi } from "vitest";
import { goalId, initMetrika, metrikaId, track, trackPage } from "./analytics";

function stubBrowser() {
  const appended: Array<{ src: string; async: boolean }> = [];
  const win: { ym?: Window["ym"] } = {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    createElement: () => ({ src: "", async: false }),
    head: { appendChild: (el: { src: string; async: boolean }) => appended.push(el) },
  });
  return { win, appended };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("metrikaId", () => {
  it("номер счётчика из окружения", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "12345678");
    expect(metrikaId()).toBe(12345678);
  });

  it.each(["", "abc", "12 34", "1e5"])("не число (%j) — счётчика нет", (raw) => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", raw);
    expect(metrikaId()).toBeNull();
  });
});

describe("goalId", () => {
  it("событие без варианта — цель по имени события", () => {
    expect(goalId("pay_click", { tier: 2, level: "rare", mode: "self", free: false })).toBe(
      "pay_click",
    );
    expect(goalId("result_view")).toBe("result_view");
  });

  it("шаг, раздел и место входят в имя цели", () => {
    expect(goalId("step_view", { step: "tier" })).toBe("step_view_tier");
    expect(goalId("section_view", { section: "faq" })).toBe("section_view_faq");
    expect(goalId("start_click", { place: "hero" })).toBe("start_click_hero");
    expect(goalId("again_click", { place: "result" })).toBe("again_click_result");
  });
});

describe("initMetrika", () => {
  it("ставит очередь, грузит tag.js и шлёт init", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "777");
    const { win, appended } = stubBrowser();
    initMetrika();
    expect(appended).toEqual([{ src: "https://mc.yandex.ru/metrika/tag.js", async: true }]);
    expect(win.ym?.a).toEqual([
      [
        777,
        "init",
        { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true },
      ],
    ]);
  });

  it("повторный вызов не ставит второй счётчик", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "777");
    const { win, appended } = stubBrowser();
    initMetrika();
    initMetrika();
    expect(appended).toHaveLength(1);
    expect(win.ym?.a).toHaveLength(1);
  });

  it("без номера счётчика ничего не грузит", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "");
    const { win, appended } = stubBrowser();
    initMetrika();
    expect(appended).toHaveLength(0);
    expect(win.ym).toBeUndefined();
  });
});

describe("track", () => {
  it("шлёт цель с параметрами в счётчик", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "777");
    const ym = vi.fn();
    vi.stubGlobal("window", { ym });
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    track("tier_selected", { tier: 2 });
    track("step_view", { step: "checkout" });
    track("copy_link");
    expect(ym.mock.calls).toEqual([
      [777, "reachGoal", "tier_selected", { tier: 2 }],
      [777, "reachGoal", "step_view_checkout", { step: "checkout" }],
      [777, "reachGoal", "copy_link", undefined],
    ]);
  });

  it("без номера счётчика никуда не шлёт", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "");
    const ym = vi.fn();
    vi.stubGlobal("window", { ym });
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    track("copy_link");
    expect(ym).not.toHaveBeenCalled();
  });

  it("сломанный счётчик не роняет экран", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "777");
    vi.stubGlobal("window", {
      ym: () => {
        throw new Error("blocked");
      },
    });
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    expect(() => track("copy_link")).not.toThrow();
  });

  it("счётчик не загрузился (блокировщик) — молча пропускает", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "777");
    vi.stubGlobal("window", {});
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    expect(() => track("copy_link")).not.toThrow();
  });
});

describe("trackPage", () => {
  it("шлёт просмотр с адресом прошлой страницы", () => {
    vi.stubEnv("NEXT_PUBLIC_YM_ID", "777");
    const ym = vi.fn();
    vi.stubGlobal("window", { ym });
    trackPage("https://funshare.test/create", "https://funshare.test/");
    expect(ym).toHaveBeenCalledWith(777, "hit", "https://funshare.test/create", {
      referer: "https://funshare.test/",
    });
  });
});
