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
