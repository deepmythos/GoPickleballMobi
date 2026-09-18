// Cầu nối DOM → quyết định cử chỉ.
//
// Vì sao tách riêng khỏi `main.ts`: cùng một hàm trích đặc điểm điểm chạm phải được
// dùng bởi CẢ production (main.ts) và test (DOM do render.ts dựng). Nếu test tự viết
// lại phép trích này thì test chỉ khẳng định bản sao của chính nó, không khẳng định
// hành vi thật của app.
//
// `gesture.ts` giữ phần QUYẾT ĐỊNH (thuần, không DOM); file này chỉ đọc DOM.

import type { TouchTargetTraits } from "./gesture";

/**
 * Thuộc tính đánh dấu "đừng mở cử chỉ ở đây" (vd: một vùng cuộn ngang tự xử lý cử chỉ).
 * Khai tại đây để adapter chạy được cả trên cây trước khi sửa (test RED cần điều đó).
 */
export const CONTROL_IGNORE_ATTR = "data-gesture-ignore";

/**
 * Đặc điểm của phần tử bắt đầu cử chỉ: chính nó + toàn bộ chuỗi tổ tiên (gần trước,
 * xa sau). Cần cả chuỗi vì cú chạm vào một nút thường trúng phần tử con (icon
 * `<svg>`/`<path>`), khi đó thẻ/role của điểm chạm không nói lên điều gì.
 */
export function touchTargetTraits(el: Element): TouchTargetTraits {
  const classNames: string[] = [];
  const tags: string[] = [];
  const roles: (string | null)[] = [];
  let marked = false;
  let node: Element | null = el;
  while (node) {
    classNames.push(...Array.from(node.classList));
    tags.push(node.tagName);
    roles.push(node.getAttribute("role"));
    if (node.hasAttribute(CONTROL_IGNORE_ATTR)) marked = true;
    node = node.parentElement;
  }
  return {
    tagName: el.tagName,
    role: el.getAttribute("role"),
    classNames,
    tags,
    roles,
    controlMarked: marked,
  };
}
