import { describe, expect, it } from "vitest";
import { isThemeChoice, resolveTheme, themeAttribute, THEME_STORAGE_KEY } from "./theme";

describe("resolveTheme", () => {
  it("keeps the three valid choices", () => {
    expect(resolveTheme("system")).toBe("system");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("falls back to system for null, empty, wrong case and bogus values", () => {
    expect(resolveTheme(null)).toBe("system");
    expect(resolveTheme("")).toBe("system");
    expect(resolveTheme("DARK")).toBe("system");
    expect(resolveTheme("bogus")).toBe("system");
    expect(resolveTheme(" dark")).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("returns null only for system", () => {
    expect(themeAttribute("system")).toBeNull();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("isThemeChoice", () => {
  it("accepts only the exact union members", () => {
    expect(isThemeChoice("system")).toBe(true);
    expect(isThemeChoice("light")).toBe(true);
    expect(isThemeChoice("dark")).toBe(true);
    expect(isThemeChoice("Dark")).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
    expect(isThemeChoice(undefined)).toBe(false);
    expect(isThemeChoice(1)).toBe(false);
  });
});

describe("THEME_STORAGE_KEY", () => {
  it("is the versioned key the inline no-flash script must reuse", () => {
    expect(THEME_STORAGE_KEY).toBe("pickleball-go-nogo.theme.v1");
  });
});
