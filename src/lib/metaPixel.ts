declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & {
      callMethod?: (...args: unknown[]) => void;
      queue?: unknown[];
      loaded?: boolean;
      version?: string;
      push?: (...args: unknown[]) => void;
    };
    _fbq?: unknown;
  }
}

export const META_PIXEL_ID = '1074429838967668';

let initialized = false;

export function initMetaPixel() {
  if (initialized || typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.location.protocol === 'file:') return;
  initialized = true;

  try {
    if (!window.fbq) {
      const n: NonNullable<Window['fbq']> = function (...args: unknown[]) {
        if (n.callMethod) {
          n.callMethod(...args);
        } else {
          n.queue?.push(args);
        }
      };
      if (!window._fbq) window._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      window.fbq = n;

      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      const firstScript = document.getElementsByTagName('script')[0];
      firstScript?.parentNode?.insertBefore(script, firstScript);
    }

    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
  } catch {
    // Bloqueadores de anúncio ou ambiente offline não devem quebrar o app.
  }
}

function safeFbq(...args: unknown[]) {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      window.fbq(...args);
    }
  } catch {
    // Bloqueadores de anúncio ou ambiente offline não devem quebrar o fluxo.
  }
}

export function trackMetaLead(opts?: { eventId?: string; source?: string }) {
  const params = {
    content_name: 'Teste Grátis 48h',
    content_category: 'Trial',
    ...(opts?.source ? { source: opts.source } : {}),
  };
  if (opts?.eventId) {
    safeFbq('track', 'Lead', params, { eventID: opts.eventId });
  } else {
    safeFbq('track', 'Lead', params);
  }
}

export function trackMetaInitiateCheckout(plan: 'monthly' | 'yearly', amountCents: number) {
  safeFbq('track', 'InitiateCheckout', {
    content_name: plan === 'yearly' ? 'VS Stage Pro Anual' : 'VS Stage Pro Mensal',
    content_category: 'Subscription',
    value: Number((amountCents / 100).toFixed(2)),
    currency: 'BRL',
  });
}
