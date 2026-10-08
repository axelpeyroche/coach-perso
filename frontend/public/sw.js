// Service worker du carnet : notifications push uniquement (aucune mise en cache).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Carnet", {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: data.tag || "carnet",
        renotify: true,
        data: { url: data.url || "/" },
      }),
      // Pastille sur l'icône de l'app (Web App Badging API)
      navigator.setAppBadge ? navigator.setAppBadge(1).catch(() => {}) : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((liste) => {
      for (const client of liste) {
        if ("focus" in client) {
          if ("navigate" in client && client.url !== url) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    })
  );
});

// L'app ouverte demande d'effacer la pastille
self.addEventListener("message", (event) => {
  if (event.data === "clearBadge" && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
});
