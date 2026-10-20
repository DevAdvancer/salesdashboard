import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import type { ExtensionResponse } from "crm-shared/types/linkedin-extension";
import { LinkedinPageController } from "../lib/linkedin-page-controller";
import { ProfileChangedError } from '../lib/page-context';

export default defineContentScript({
  matches: ["https://www.linkedin.com/*", "https://linkedin.com/*"],
  runAt: "document_start",
  main(ctx) {
    const controller = new LinkedinPageController(async <T>(message: unknown) => {
      const response = await browser.runtime.sendMessage(message) as ExtensionResponse<T> | undefined;
      if (response && !response.ok && response.code === 'PROFILE_CHANGED') throw new ProfileChangedError();
      if (!response?.ok || !response.data) throw new Error(response && !response.ok ? response.error : "CRM connection lost. Sending is blocked; reload LinkedIn Helper.");
      return response.data;
    });
    const stop = controller.start();
    const changed = (changes: Record<string, unknown>) => {
      if (changes.trackingLock || changes.crmOrigin) void controller.refresh();
    };
    browser.storage.onChanged.addListener(changed);
    ctx.onInvalidated(() => { stop(); browser.storage.onChanged.removeListener(changed); });
  },
});
