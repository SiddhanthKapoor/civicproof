"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Registers the service worker in production (in development it would cache stale builds). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

/**
 * "Install the app" for browsers that offer it (Chrome, Edge, Android). Safari has no install event,
 * so iPhone users get the Share-sheet instruction instead. Hidden once installed. Renders a list item.
 */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    queueMicrotask(() => {
      setInstalled(window.matchMedia("(display-mode: standalone)").matches);
      setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (prompt) {
    const install = async () => {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") setInstalled(true);
      setPrompt(null);
    };
    return (
      <li>
        <button type="button" onClick={install} className="text-left hover:text-ink">
          Install the app
        </button>
      </li>
    );
  }
  if (ios) return <li>Install: tap Share, then “Add to Home Screen”</li>;
  return null;
}
