import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { ensureMigrated } from "@/lib/migrate";

const handlers = toNextJsHandler(auth);

export async function GET(request: Request) {
  await ensureMigrated();
  return handlers.GET(request);
}

export async function POST(request: Request) {
  await ensureMigrated();
  return handlers.POST(request);
}
