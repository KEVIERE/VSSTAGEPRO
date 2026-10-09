// Permite que a tela do palco abra como um app de tela cheia (sem a barra do navegador).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
