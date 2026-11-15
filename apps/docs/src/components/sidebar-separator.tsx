"use client";

import type { SidebarPageTreeComponents } from "fumadocs-ui/components/sidebar/page-tree";

/**
 * A sidebar section heading (`---Guides---` in `meta.json`). Fumadocs draws
 * it like a page link, only darker, so it reads as a link that does nothing;
 * small muted capitals make it a heading. An unnamed `---` stays a gap.
 */
export const SidebarSeparator: SidebarPageTreeComponents["Separator"] = ({ item }) => (
  <p className="mt-6 mb-1 inline-flex items-center gap-2 px-2 text-xs font-medium uppercase tracking-wider text-fd-muted-foreground first:mt-0 empty:mb-0 [&_svg]:size-4 [&_svg]:shrink-0">
    {item.icon}
    {item.name}
  </p>
);
