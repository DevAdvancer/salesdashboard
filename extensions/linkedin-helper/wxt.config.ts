import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  alias: {
    "crm-shared": fileURLToPath(new URL("../../lib", import.meta.url)),
  },
  manifest: {
    name: "CRM HUB LinkedIn Helper",
    description: "Check LinkedIn profile history and record sent requests in CRM HUB.",
    permissions: ["activeTab", "storage", "scripting"],
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    optional_host_permissions: ["https://*/*"],
    icons: { 16: "/silverspace.png", 32: "/silverspace.png", 48: "/silverspace.png", 128: "/silverspace.png" },
    action: { default_title: "CRM HUB LinkedIn Helper" },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  },
});
