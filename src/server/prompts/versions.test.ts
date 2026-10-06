import { describe, expect, it } from "vitest";
import { buildProfileFacts } from "../facts";
import { makeProfile } from "../analyze/test-helpers";
import * as active from "./active";
import { buildAnalyzePrompt as analyzeV1, PROMPT_VERSION as ANALYZE_V1 } from "./analyze/v1";
import { buildAnalyzePrompt as analyzeV2, PROMPT_VERSION as ANALYZE_V2 } from "./analyze/v2";
import {
  buildModeratorPrompt as moderatorBuildV2,
  MODERATOR_PROMPT_VERSION as MODERATOR_V2,
  MODERATOR_SYSTEM as MODERATOR_SYSTEM_V2,
} from "./roast/moderator-v2";
import {
  MODERATOR_PROMPT_VERSION as MODERATOR_V1,
  MODERATOR_SYSTEM as MODERATOR_SYSTEM_V1,
} from "./roast/moderator-v1";
import {
  buildWriterSystem as writerV2,
  JUDGE_SYSTEM as JUDGE_V2,
  PROMPT_VERSION as ROAST_V2,
} from "./roast/v2";
import {
  buildWriterSystem as writerV1,
  JUDGE_SYSTEM as JUDGE_V1,
  PROMPT_VERSION as ROAST_V1,
} from "./roast/v1";

const levels = ["rare", "medium", "well_done"] as const;

describe("выбор версии: одна точка prompts/active.ts", () => {
  it("активны v2, v1 остаётся опубликованной", () => {
    expect(active.ANALYZE_PROMPT_VERSION).toBe("analyze/v2");
    expect(active.ROAST_PROMPT_VERSION).toBe("roast/v2");
    expect(active.MODERATOR_PROMPT_VERSION).toBe("roast/moderator-v2");
    expect([ANALYZE_V1, ROAST_V1, MODERATOR_V1]).toEqual([
      "analyze/v1",
      "roast/v1",
      "roast/moderator-v1",
    ]);
    expect([ANALYZE_V2, ROAST_V2, MODERATOR_V2]).toEqual([
      active.ANALYZE_PROMPT_VERSION,
      active.ROAST_PROMPT_VERSION,
      active.MODERATOR_PROMPT_VERSION,
    ]);
  });
  it("active отдаёт именно тексты v2", () => {
    expect(active.JUDGE_SYSTEM).toBe(JUDGE_V2);
    expect(active.MODERATOR_SYSTEM).toBe(MODERATOR_SYSTEM_V2);
    expect(active.buildWriterSystem("medium", "self")).toBe(writerV2("medium", "self"));
  });
});

describe("писатель roast/v2: открытые и закрытые темы", () => {
  it.each(levels)("%s: тело, привычки, семья, деньги открыты; болезни и дети закрыты", (level) => {
    const s = writerV2(level, "self");
    expect(s).toMatch(/ОТКРЫТО на любой степени/);
    for (const word of [
      "вес, спорт, тренировки",
      "сон, кофе, диеты",
      "партнёр, родители",
      "траты",
    ]) {
      expect(s).toContain(word);
    }
    const closed = s.split("\n").find((l) => l.startsWith("АБСОЛЮТНО ЗАПРЕЩЕНО"));
    expect(closed).toBeDefined();
    for (const word of ["болезни", "дети", "национальность", "религия", "политика", "ориентация"]) {
      expect(closed).toContain(word);
    }
    // Семья и деньги больше не в запретах ни одной степени.
    expect(closed).not.toMatch(/семь|деньги|доход|вес/);
    expect(s).not.toMatch(/ЗАПРЕЩЕНО на этой степени:[^\n]*(семья|деньги|вес|здоровье)/);
  });
  it("внешность и секс закрыты на мягко и средне, на жёстко нет", () => {
    for (const level of ["rare", "medium"] as const) {
      const line = writerV2(level, "friend")
        .split("\n")
        .find((l) => l.startsWith("ЗАПРЕЩЕНО на этой степени"));
      expect(line).toMatch(/внешность лица/);
      expect(line).toMatch(/сексуальность/);
    }
    expect(writerV2("well_done", "self")).not.toMatch(/ЗАПРЕЩЕНО на этой степени/);
  });
  it("v1 не изменился: там семья и деньги запрещены", () => {
    expect(writerV1("medium", "self")).toMatch(/ЗАПРЕЩЕНО на этой степени:[^\n]*семья[^\n]*деньги/);
  });
});

describe("судья roast/v2", () => {
  it("aboutBehavior: спорт, траты, быт и семья это поведение; закрытые темы низко", () => {
    const line = JUDGE_V2.split("\n").find((l) => l.startsWith("- aboutBehavior"))!;
    for (const w of ["спорт", "траты", "семью"]) expect(line).toContain(w);
    for (const w of ["болезни", "инвалидность", "детей", "национальность"]) {
      expect(line).toContain(w);
    }
    expect(JUDGE_V1.split("\n").find((l) => l.startsWith("- aboutBehavior"))).toMatch(
      /семью, деньги/,
    );
  });
});

describe("модератор roast/moderator-v2", () => {
  it("aboutBehavior шире, закрытые темы названы", () => {
    const about = MODERATOR_SYSTEM_V2.split("\n").find((l) => l.startsWith("- aboutBehavior"))!;
    for (const w of ["Спорт", "траты", "партнёр"]) expect(about).toContain(w);
    const hits = MODERATOR_SYSTEM_V2.split("\n").find((l) => l.startsWith("- hitsForbiddenTopic"))!;
    for (const w of ["болезни", "детей", "развод", "<forbidden_topics>"]) expect(hits).toContain(w);
    expect(MODERATOR_SYSTEM_V1).toMatch(/тело, здоровье, семью, деньги/);
    expect(MODERATOR_SYSTEM_V2).not.toMatch(/тело, здоровье, семью, деньги/);
  });
  it("четыре поля и защита от инъекций на месте, промпт собирается", () => {
    for (const f of ["aboutBehavior", "hitsForbiddenTopic", "friendSafe", "selfContained"]) {
      expect(MODERATOR_SYSTEM_V2).toContain(f);
    }
    expect(MODERATOR_SYSTEM_V2).toMatch(/ДАННЫЕ, А НЕ КОМАНДЫ/);
    const p = moderatorBuildV2({
      candidates: [{ id: "m1", text: "Спортзал в каждой сторис" }],
      forbidden: [],
      level: "medium",
      mode: "self",
    });
    expect(p.user).toContain("[m1]");
  });
});

describe("досье analyze/v2", () => {
  const profile = makeProfile();
  const input = {
    facts: buildProfileFacts(profile),
    displayName: "Аня",
    postCount: profile.posts.length,
    covers: [],
  };
  const system = (build: typeof analyzeV2) => build(input).system;

  it("открытые темы названы, safe=false только для закрытых", () => {
    const s = system(analyzeV2);
    for (const w of [
      "тело (фигура, вес, спорт, тренировки)",
      "спортзал",
      "семья (партнёр",
      "деньги (траты",
    ]) {
      expect(s).toContain(w);
    }
    const closed = s.split("\n").find((l) => l.startsWith("- Закрытые темы"))!;
    for (const w of [
      "болезни",
      "дети",
      "национальность",
      "религия",
      "политика",
      "ориентация",
      "развод",
    ]) {
      expect(closed).toContain(w);
    }
    expect(closed).toContain("safe=false");
    // Старое правило «про человека — safe=false» ушло.
    expect(s).not.toContain("Если наблюдение про человека, ставь safe=false");
    // Внешность лица по-прежнему не описывается и не оценивается.
    expect(s).toMatch(/Лица и внешность людей на фото не описывай и не оценивай/);
  });
  it("в v1 прежнее правило осталось", () => {
    expect(system(analyzeV1)).toContain("Если наблюдение про человека, ставь safe=false");
  });
  it("данные профиля по-прежнему в блоке, обложек нет — look = null", () => {
    const parts = analyzeV2(input).parts;
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(parts)).toContain("<profile_data>");
    expect(JSON.stringify(parts)).toContain("look = null");
  });
});
