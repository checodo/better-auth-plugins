import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { SidebarFooter } from "@/components/sidebar-footer";
import { SidebarSeparator } from "@/components/sidebar-separator";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  const { links, ...options } = baseOptions();
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...options}
      // GitHub and the theme switch live in our own footer instead.
      links={links?.filter((link) => link.type !== "icon")}
      themeSwitch={{ enabled: false }}
      sidebar={{ footer: <SidebarFooter />, components: { Separator: SidebarSeparator } }}
    >
      {children}
    </DocsLayout>
  );
}
