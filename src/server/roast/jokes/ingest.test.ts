import { describe, expect, it } from "vitest";
import { LABEL_PROMPT_VERSION } from "../../prompts/jokes/label-v1";
import { planIngest, runIngest } from "./ingest";
import type { LabelGenerate } from "./label";
import type { CardWrite, ExistingCard } from "./repository";
import { textHash } from "./text";

const MD = `## 1. Раздел

1. Ты носишь кепку чтобы хоть какая-то крыша над головой была у тебя.
2. Совсем другая шутка про самокат и вечный дедлайн на работе.
3. Ты носишь кепку, чтобы хоть какая-то КРЫША над головой была у тебя!
4. Пошлая шутка про носки. 🔞
`;

const response = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  mechanism: "reversal",
  skeleton: "{Действие} ради {результат}",
  slots: ["object"],
  heat: "mild",
  topic: "behavior",
  redline: false,
  wellDoneOnly: false,
  nsfw: false,
  transferable: true,
  ...over,
});

const llm =
  (over: (id: number) => Record<string, unknown> = () => ({})): LabelGenerate =>
  async ({ user }) => ({
    items: [...user.matchAll(/<joke id="(\d+)">/g)].map((m) =>
      response(Number(m[1]), over(Number(m[1]))),
    ),
  });

function deps(generate: LabelGenerate) {
  const saved: CardWrite[] = [];
  return {
    saved,
    deps: {
      generate,
      save: async (rows: readonly CardWrite[]) => void saved.push(...rows),
      model: "test",
    },
  };
}

describe("planIngest", () => {
  it("без БД: дубль по нормализованному тексту отсекается, остальное новое", () => {
    const plan = planIngest(MD, []);
    expect(plan.parsed).toBe(4);
    expect(plan.duplicates).toEqual([{ source: "s1#3", of: "s1#1" }]);
    expect(plan.entries.map((e) => e.record.source)).toEqual(["s1#1", "s1#2", "s1#4"]);
    expect(plan.entries.every((e) => e.kind === "new")).toBe(true);
  });

  it("неизменённые пропускаются, изменённые помечаются, пропавшие считаются", () => {
    const { records } = { records: planIngest(MD, []).entries.map((e) => e.record) };
    const existing: ExistingCard[] = [
      // s1#1 без изменений
      {
        source: "s1#1",
        text: records[0]!.text,
        textHash: textHash(records[0]!.text, false),
        approved: true,
      },
      // s1#2 в БД другой текст -> изменён
      {
        source: "s1#2",
        text: "старый текст",
        textHash: textHash("старый текст", false),
        approved: true,
      },
      // нет в файле
      { source: "s9#9", text: "лишняя", textHash: "x", approved: false },
    ];
    const plan = planIngest(MD, existing);
    expect(plan.unchanged).toBe(1);
    expect(plan.entries.map((e) => [e.record.source, e.kind])).toEqual([
      ["s1#2", "changed"],
      ["s1#4", "new"],
    ]);
    expect(plan.missingInSource).toEqual(["s9#9"]);
    // s1#3 дубль уже лежащего в банке s1#1
    expect(plan.duplicates).toEqual([{ source: "s1#3", of: "s1#1" }]);
  });

  it("повторный прогон по тому же состоянию: нечего размечать", () => {
    const first = planIngest(MD, []);
    const existing = first.entries.map((e) => ({
      source: e.record.source,
      text: e.record.text,
      textHash: e.hash,
      approved: true,
    }));
    const again = planIngest(MD, existing);
    expect(again.entries).toEqual([]);
    expect(again.unchanged).toBe(3);
  });

  it("добавленная пометка 🔞 меняет хэш: карточка пересматривается", () => {
    const [first] = planIngest(
      "## 1. Р\n\n1. Шутка про чай и печеньки в среду утром.\n",
      [],
    ).entries;
    const withMark = planIngest("## 1. Р\n\n1. Шутка про чай и печеньки в среду утром. 🔞\n", [
      { source: "s1#1", text: first!.record.text, textHash: first!.hash, approved: true },
    ]);
    expect(withMark.entries.map((e) => e.kind)).toEqual(["changed"]);
  });
});

describe("runIngest", () => {
  it("пишет размеченное, флаги выводит код: тема health → redline, 🔞 → nsfw", async () => {
    const { saved, deps: d } = deps(
      // модель «забывает» красную линию и nsfw
      llm((id) => (id === 2 ? { topic: "health", redline: false } : {})),
    );
    const report = await runIngest(planIngest(MD, []), d);
    expect(report).toMatchObject({ new: 3, changed: 0, written: 3, failed: [] });
    expect(report.duplicates).toHaveLength(1);

    const bySource = Object.fromEntries(saved.map((r) => [r.source, r]));
    // порядок id в пакете = порядок entries: s1#1=0, s1#2=1, s1#4=2
    expect(bySource["s1#4"]?.label.topic).toBe("health");
    expect(bySource["s1#4"]?.label.redline).toBe(true);
    expect(bySource["s1#4"]?.label.nsfw).toBe(true);
    expect(bySource["s1#1"]?.label.nsfw).toBe(false);
    expect(
      saved.every((r) => r.labelVersion === LABEL_PROMPT_VERSION && r.labelModel === "test"),
    ).toBe(true);
    expect(bySource["s1#1"]?.textHash).toHaveLength(64);
  });

  it("отчёт перечисляет source карточек, которых нет в файле (их одобрение снимают руками)", async () => {
    const { deps: d } = deps(llm(() => ({})));
    const gone: ExistingCard = { source: "s9#9", text: "x", textHash: "x", approved: true };
    const report = await runIngest(planIngest(MD, [gone]), d);
    expect(report.missingInSource).toEqual(["s9#9"]);
  });

  it("невалидная разметка не пишется в БД и попадает в отчёт", async () => {
    const { saved, deps: d } = deps(llm((id) => (id === 1 ? { heat: "nuclear" } : {})));
    const report = await runIngest(planIngest(MD, []), d);
    expect(saved.map((r) => r.source)).toEqual(["s1#1", "s1#4"]);
    expect(report.written).toBe(2);
    expect(report.failed).toEqual([{ key: "s1#2", reason: "invalid:heat" }]);
  });

  it("всё упало: save не вызывается", async () => {
    const { saved, deps: d } = deps(async () => {
      throw new Error("net");
    });
    const report = await runIngest(planIngest(MD, []), d);
    expect(saved).toEqual([]);
    expect(report.written).toBe(0);
    expect(report.failed).toHaveLength(3);
  });

  it("пишет порциями: сбой записи посреди прогона не теряет уже записанное", async () => {
    const topics = ["кота", "лампу", "чай", "дом", "лес"];
    const md =
      "## 1. Р\n\n" +
      topics.map((t, i) => `${i + 1}. Совсем уникальная мысль номер ${i + 1} про ${t}.`).join("\n");
    const saved: string[] = [];
    let calls = 0;
    const d = {
      generate: llm(),
      model: "test",
      batchSize: 1,
      concurrency: 2,
      save: async (rows: readonly CardWrite[]) => {
        calls += 1;
        if (calls === 2) throw new Error("db down");
        saved.push(...rows.map((r) => r.source));
      },
    };
    await expect(runIngest(planIngest(md, []), d)).rejects.toThrow("db down");
    expect(saved).toEqual(["s1#1", "s1#2"]);
  });
});
