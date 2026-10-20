import { fileURLToPath } from "node:url";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  zip: { artifactTemplate: "LinkedIn Helper.zip" },
  hooks: {
    async "zip:extension:done"(wxt, zipPath) {
      if (wxt.config.browser !== "chrome" || wxt.config.mode !== "production") return;
      const downloadPath = fileURLToPath(new URL("../../releases/linkedin-helper/LinkedIn Helper.zip", import.meta.url));
      await mkdir(dirname(downloadPath), { recursive: true });
      await copyFile(zipPath, downloadPath);
    },
  },
  alias: {
    "crm-shared": fileURLToPath(new URL("../../lib", import.meta.url)),
  },
  manifest: {
    name: "LinkedIn Helper",
    description: "Lock a LinkedIn account, check CRM availability, and record confirmed invitations automatically.",
    permissions: ["activeTab", "storage", "scripting"],
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    optional_host_permissions: ["https://*/*"],
    icons: { 16: "/silverspace.png", 32: "/silverspace.png", 48: "/silverspace.png", 128: "/silverspace.png" },
    action: { default_title: "LinkedIn Helper" },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  },
});
