import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile's widget, loaded from Cloudflare's script and rendered
 * explicitly. Calls `onToken` with each token (and null when one expires).
 * Tokens are single use, so the form resets the widget after every submit
 * through `resetRef`.
 *
 * When a script-src CSP lands (docs/adr/0014), it must allow
 * https://challenges.cloudflare.com.
 */

declare global {
  interface Window {
    turnstile?: {
      render(
        el: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ): string;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

const SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoaded: Promise<void> | undefined;

function loadScript(): Promise<void> {
  scriptLoaded ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoaded = undefined;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptLoaded;
}

export function Turnstile({
  siteKey,
  onToken,
  resetRef,
}: {
  readonly siteKey: string;
  readonly onToken: (token: string | null) => void;
  readonly resetRef: { current: (() => void) | null };
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
      resetRef.current = () => {
        if (widgetId) window.turnstile?.reset(widgetId);
        onToken(null);
      };
    });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
      resetRef.current = null;
    };
  }, [siteKey]);

  return <div ref={container} />;
}
