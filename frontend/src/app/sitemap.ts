import type { MetadataRoute } from "next";
import { MODULES } from "@/lib/modules";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, priority: 1 }, ...MODULES.map((m) => ({ url: `${SITE_URL}${m.href}` }))];
}
