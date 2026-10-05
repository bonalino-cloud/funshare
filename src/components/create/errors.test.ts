import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/client/api";
import { errorLine, generationErrorLine, startErrorLine } from "./errors";

describe("generationErrorLine", () => {
  it("404 — чужая ссылка или потерянная cookie, а не поломка у нас", () => {
    const line = generationErrorLine(new ApiError("internal", 404));
    expect(line).toContain("только там, где её запускали");
    expect(line).not.toBe(errorLine("internal"));
  });

  it("обрыв сети — про связь, а не «у нас сломалось»", () => {
    const line = generationErrorLine(new TypeError("Failed to fetch"));
    expect(line).toContain("связь");
    expect(line).not.toBe(errorLine("internal"));
  });

  it("5xx и прочее — общий текст по коду", () => {
    expect(generationErrorLine(new ApiError("internal", 503))).toBe(errorLine("internal"));
    expect(generationErrorLine(new ApiError("rate_limited", 429))).toBe(errorLine("rate_limited"));
  });
});

describe("startErrorLine", () => {
  it("410 — проверка профиля устарела, а не «профиля нет»", () => {
    const line = startErrorLine(new ApiError("profile_not_found", 410));
    expect(line).toContain("устарела");
    expect(line).not.toBe(errorLine("profile_not_found"));
  });

  it("остальные коды — текст по коду", () => {
    expect(startErrorLine(new ApiError("promo_invalid", 400))).toBe(errorLine("promo_invalid"));
    expect(startErrorLine(new ApiError("payment_required", 402))).toBe(
      errorLine("payment_required"),
    );
  });

  it("обрыв сети на старте — про связь", () => {
    expect(startErrorLine(new TypeError("Failed to fetch"))).toContain("связь");
  });
});
