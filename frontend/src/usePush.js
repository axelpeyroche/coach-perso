import { useEffect } from "react";
import api from "./api";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushNotifications() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        // Already subscribed?
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          try {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });
          } catch {
            // User denied or not supported
            return;
          }
        }
        const { endpoint, keys } = sub.toJSON();
        await api.post("/push/subscribe", {
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        }).catch(() => {});
      })
      .catch(() => {});
  }, []);
}
