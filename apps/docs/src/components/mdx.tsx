import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { ColorSwatches, FullLogoPreview, LockupPreview, LogoPreview } from "@/components/brand";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ColorSwatches,
    FullLogoPreview,
    LockupPreview,
    LogoPreview,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
