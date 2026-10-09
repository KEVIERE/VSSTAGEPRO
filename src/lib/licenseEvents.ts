// Pede ao DirectorAccess para conferir a licença de novo (depois do pagamento no Stripe).
export const LICENSE_REFRESH_EVENT = 'vs-license-refresh';
export const refreshLicense = () => window.dispatchEvent(new Event(LICENSE_REFRESH_EVENT));
