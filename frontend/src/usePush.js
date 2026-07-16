import { useEffect } from "react";

export function usePushNotifications() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then(async () => {
      // Effacer la pastille dès que l'app est ouverte
      const sw = await navigator.serviceWorker.ready;
      sw.active?.postMessage("clearBadge");
      if (navigator.clearAppBadge) navigator.clearAppBadge();
    }).catch(() => {});
  }, []);
}
