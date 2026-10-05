// Les notifications push ont été retirées : ce service worker se désinscrit
// lui-même sur les appareils où l'ancienne version était installée.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.registration.unregister());
});
