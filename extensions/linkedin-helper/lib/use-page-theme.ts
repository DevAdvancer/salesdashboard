import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

/** Runs in the active LinkedIn tab. Reads presentation only, never profile content. */
export function readPageTheme(): "light" | "dark" {
  for (const element of [document.body, document.documentElement]) {
    if (!element) continue;
    const color = getComputedStyle(element).backgroundColor;
    const values = color.match(/[\d.]+/g)?.map(Number);
    if (values && values.length >= 3 && (values.length < 4 || (values[3] ?? 0) > 0.5)) {
      const brightness = (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
      return brightness < 128 ? "dark" : "light";
    }
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function usePageTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    async function sync() {
      if (busy) return;
      busy = true;
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const stored = await browser.storage.session.get("linkedinTheme");
        let next = stored.linkedinTheme as "light" | "dark" | undefined;
        if (tab?.id !== undefined && tab.url && /^(www\.)?linkedin\.com$/.test(new URL(tab.url).hostname)) {
          const [result] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: readPageTheme });
          if (result?.result === "light" || result?.result === "dark") {
            next = result.result;
            await browser.storage.session.set({ linkedinTheme: next });
          }
        }
        if (!cancelled && (next === "light" || next === "dark")) setTheme(next);
      } catch { /* When page access is unavailable, retain the last theme or system preference. */ }
      finally { busy = false; }
    }
    void sync();
    const timer = setInterval(() => { void sync(); }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}
