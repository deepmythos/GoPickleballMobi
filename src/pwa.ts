// Đăng ký service worker + cập nhật thủ công.
// Không hẹn giờ: nhắc cập nhật không tự hiện, chỉ hiện khi service worker báo có bản mới.

let controllerChangeAttached = false;

export function initPwa(handlers: { onUpdateAvailable: () => void }): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !import.meta.env.PROD) {
    return;
  }

  const register = (): void => {
    navigator.serviceWorker
      .register("sw.js")
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          handlers.onUpdateAvailable();
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              handlers.onUpdateAvailable();
            }
          });
        });
      })
      .catch(() => {
        /* service worker là lớp tăng cường, không được làm app chết */
      });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

export function applyUpdate(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  if (!controllerChangeAttached) {
    controllerChangeAttached = true;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  }

  void navigator.serviceWorker.getRegistration().then((registration) => {
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  });
}

export type UpdateCheckResult = "current" | "available" | "unsupported" | "error";

/**
 * Bấm "Kiểm tra cập nhật": hỏi service worker hiện có bản mới hay chưa.
 * Kết quả trả về LUÔN là một trong bốn trạng thái, không bao giờ "im lặng":
 * - "unsupported": thiết bị/trình duyệt không có service worker hoặc chưa có registration.
 * - "available": có bản mới đang chờ hoặc đang cài.
 * - "current": đã kiểm tra xong và không có bản mới.
 * - "error": bất kỳ lỗi nào khi kiểm tra.
 * Không hẹn giờ (không dùng bộ đếm thời gian): chỉ chạy khi người dùng chủ động bấm.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
    const serviceWorker = navigator.serviceWorker;
    if (!serviceWorker || typeof serviceWorker.getRegistration !== "function") return "unsupported";
    const registration = await serviceWorker.getRegistration();
    if (!registration) return "unsupported";
    if (registration.waiting) return "available";
    await registration.update();
    if (registration.waiting || registration.installing) return "available";
    return "current";
  } catch {
    return "error";
  }
}
