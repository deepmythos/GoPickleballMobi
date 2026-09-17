// Lựa chọn giao diện sáng/tối — module THUẦN, không đọc DOM, không đọc clock.
// Khoá localStorage phải khớp khít với inline script chống nháy trong index.html.

export const THEME_STORAGE_KEY = "pickleball-go-nogo.theme.v1";

export type ThemeChoice = "system" | "light" | "dark";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/** Giá trị trong localStorage → lựa chọn hợp lệ; sai/None → "system". */
export function resolveTheme(stored: string | null): ThemeChoice {
  return isThemeChoice(stored) ? stored : "system";
}

/** Lựa chọn → giá trị `data-theme`; "system" trả null (không set gì = theo máy). */
export function themeAttribute(choice: ThemeChoice): string | null {
  return choice === "system" ? null : choice;
}
