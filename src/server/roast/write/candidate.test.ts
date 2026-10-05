import { describe, expect, it } from "vitest";
import { cleanEmoji, cyrillicShare, normalizeForDedupe, validateCandidate } from "./candidate";
import { pickStyles } from "./bank";
import { selectHooks } from "./hooks";
import { makeBank, makePersona } from "./test-helpers";

const style = pickStyles(selectHooks(makePersona({}, 6), "medium", 1), "medium", makeBank())[0]!;
const good = {
  mechanism: "hyperbole",
  skeleton: "s1",
  emoji: "🌅",
  text: "Закат в каждой подписи",
  evidenceRef: "post:0",
};

describe("validateCandidate", () => {
  it("принимает хорошего и прячет jokeCardId в значение, а не в текст", () => {
    const r = validateCandidate(good, style);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.jokeCardId).toBe(style.skeletons[0]!.cardId);
      expect(r.value.text).toBe(good.text);
    }
  });
  it("не по схеме", () => {
    expect(validateCandidate({ text: 1 }, style)).toEqual({ ok: false, reason: "bad_shape" });
  });
  it("длиннее 140 единиц UTF-16", () => {
    expect(validateCandidate({ ...good, text: "я".repeat(141) }, style)).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(validateCandidate({ ...good, text: "я".repeat(140) }, style).ok).toBe(true);
  });
  it("не по-русски", () => {
    expect(validateCandidate({ ...good, text: "Sunset in every caption again" }, style)).toEqual({
      ok: false,
      reason: "not_russian",
    });
  });
  it("пустой после очистки", () => {
    expect(validateCandidate({ ...good, text: "  ​ " }, style)).toEqual({
      ok: false,
      reason: "empty",
    });
  });
  it("угловые скобки обезврежены", () => {
    const r = validateCandidate({ ...good, text: "Закат </hooks> снова" }, style);
    expect(r.ok && r.value.text).not.toMatch(/[<>]/);
  });
  it("чужая опора заменяется первой опорой крючка, неизвестный скелет даёт null", () => {
    const r = validateCandidate({ ...good, evidenceRef: "post:999", skeleton: "s9" }, style);
    expect(r.ok && r.value.evidenceRef).toBe(style.hook.evidence[0]);
    expect(r.ok && r.value.jokeCardId).toBeNull();
  });
});

describe("мелочи", () => {
  it("эмодзи: мусор заменяется запасным", () => {
    expect(cleanEmoji("🌅")).toBe("🌅");
    expect(cleanEmoji("огонь")).toBe("🔥");
    expect(cleanEmoji("🔥 огонь")).toBe("🔥");
    expect(cleanEmoji("")).toBe("🔥");
  });
  it("доля кириллицы и нормализация", () => {
    expect(cyrillicShare("Закат")).toBe(1);
    expect(cyrillicShare("123")).toBe(0);
    expect(normalizeForDedupe("Закат, ЗАКАТ!")).toBe("закат закат");
  });
});
