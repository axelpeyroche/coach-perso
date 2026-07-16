self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Coach EPC", {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: data.tag || "coach-epc",
        renotify: true,
        data: { url: data.url || "/" },
      }),
      // Pastille rouge sur l'icône de l'app (Web App Badging API)
      navigator.setAppBadge ? navigator.setAppBadge(1) : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Effacer la pastille quand l'utilisateur clique
  if (navigator.clearAppBadge) navigator.clearAppBadge();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Effacer la pastille quand l'utilisateur ouvre l'app
self.addEventListener("message", (event) => {
  if (event.data === "clearBadge" && navigator.clearAppBadge) {
    navigator.clearAppBadge();
  }
});
