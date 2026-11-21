import { defineLibraryConfig } from "@repo/tooling/tsdown";

export default defineLibraryConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    lists: "src/lists/index.ts",
    "lists/disposable-email-domains": "src/lists/disposable-email-domains.ts",
    "lists/privacy-relay-domains": "src/lists/privacy-relay-domains.ts",
    "lists/reserved-usernames": "src/lists/reserved-usernames.ts",
  },
});
