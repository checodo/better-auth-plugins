import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import { GitHubIcon, githubUrl } from "@/lib/layout.shared";

/**
 * The docs sidebar footer: GitHub and the theme switch side by side in a
 * compact box on the right. Replaces Fumadocs' own footer bar, which spans
 * the whole sidebar and puts icon links at the far left.
 */
export function SidebarFooter() {
  return (
    <div className="flex justify-end">
      <div className="flex items-center gap-0.5 rounded-lg border bg-fd-secondary/50 p-0.5 text-fd-muted-foreground">
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub"
          className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground [&_svg]:size-4"
        >
          <GitHubIcon />
        </a>
        <ThemeSwitch className="border-0 p-0 *:rounded-md" />
      </div>
    </div>
  );
}
