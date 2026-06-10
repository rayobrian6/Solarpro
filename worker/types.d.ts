/* Worker-specific type stubs — avoids pulling in dom lib */

interface Window {
  onerror: ((...args: unknown[]) => void) | undefined;
  addEventListener(type: string, listener: (...args: unknown[]) => void): void;
  location: { href: string; hostname: string; pathname: string };
}

declare var window: Window | undefined;
