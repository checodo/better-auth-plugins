import { defineLibraryConfig } from "@repo/tooling/tsdown";

export default defineLibraryConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    email: "src/email.ts",
    phone: "src/phone.ts",
  },
});
