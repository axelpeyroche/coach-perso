// Service worker du carnet : notifications push, et coquille de l'app gardée en cache pour
// qu'elle s'ouvre sans réseau. Les données de l'API ne passent pas ici : elles sont gardées par l'app (api.js).
const COQUILLE = "carnet-coquille-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(COQUILLE).then((c) => c.add(new Request("/", { cache: "reload" }))).catch(() => {}));
});
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys()
    .then((noms) => Promise.all(noms.filter((n) => n.startsWith("carnet-coquille-") && n !== COQUILLE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim())
));

const garder = (requete, reponse) => {
  if (reponse && reponse.ok && reponse.type === "basic") {
    const copie = reponse.clone();
    caches.open(COQUILLE).then((c) => c.put(requete, copie)).catch(() => {});
  }
  return reponse;
};

self.addEventListener("fetch", (event) => {
  const r = event.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Ouverture d'une page : le réseau d'abord, sinon la dernière coquille connue
  if (r.mode === "navigate") {
    event.respondWith(fetch(r).then((rep) => garder("/", rep)).catch(() => caches.match("/").then((c) => c || Response.error())));
    return;
  }
  // Fichiers de l'app (noms uniques à chaque version) : le cache d'abord
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(caches.match(r).then((c) => c || fetch(r).then((rep) => garder(r, rep))));
    return;
  }
  // Icônes, manifeste, polices : le réseau d'abord, sinon le cache
  if (/\.(png|svg|ico|json|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(fetch(r).then((rep) => garder(r, rep)).catch(() => caches.match(r).then((c) => c || Response.error())));
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Mon Carnet", {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: data.tag || "carnet",
        renotify: true,
        data: { url: data.url || "/" },
        // Boutons d'action (Android, ordinateur) : chaque action porte le chemin à ouvrir
        actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
      }),
      // Pastille sur l'icône de l'app (Web App Badging API)
      navigator.setAppBadge ? navigator.setAppBadge(1).catch(() => {}) : Promise.resolve(),
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  const chemin = event.action && event.action.startsWith("/") ? event.action : event.notification.data?.url || "/";
  const url = new URL(chemin, self.location.origin).href;
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
