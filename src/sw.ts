// Desregistra qualquer Service Worker legado para evitar cache preso em navegadores mobile
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  }).catch(() => {});
  if ('caches' in window) {
    caches.keys().then((names) => {
      for (const name of names) caches.delete(name);
    }).catch(() => {});
  }
}
