import type { AuthContext } from "@better-auth/core";
import type { AuditEvent, ResolvedDestination } from "./types";

type Context = Pick<AuthContext, "logger" | "runInBackground">;

interface Queue {
  items: unknown[];
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Resolves when the timer's flush is done; kept alive with `runInBackground`. */
  done: (() => void) | undefined;
}

export type Dispatcher = ReturnType<typeof createDispatcher>;

/**
 * Sends stored events to the `destinations`, in the background: filter,
 * `transform`, batch, `send` with a timeout. Never throws; errors are
 * logged with the destination's name. Best effort: queued events live in
 * memory until they are sent.
 */
export function createDispatcher(destinations: readonly ResolvedDestination[]) {
  const queues = new Map<string, Queue>(
    destinations.map((destination) => [
      destination.name,
      { items: [], timer: undefined, done: undefined },
    ]),
  );
  /** Every transform and send still running, for `flush`. */
  const pending = new Set<Promise<void>>();
  let logger: Context["logger"] | undefined;

  const track = (task: Promise<void>) => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
    return task;
  };

  const fail = (destination: ResolvedDestination, error: unknown) =>
    logger?.error(`[audit-log] destination "${destination.name}" failed`, error);

  async function send(destination: ResolvedDestination, batch: unknown[]): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`timed out after ${destination.timeout} ms`);
        controller.abort(error);
        reject(error);
      }, destination.timeout);
    });
    try {
      await Promise.race([
        (async () => destination.send(batch, { signal: controller.signal }))(),
        timeout,
      ]);
    } catch (error) {
      fail(destination, error);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sends what is queued for a destination, in batches of its `size`. */
  function drain(destination: ResolvedDestination): Promise<void> {
    const queue = queues.get(destination.name);
    if (!queue) return Promise.resolve();
    clearTimeout(queue.timer);
    queue.timer = undefined;
    const done = queue.done;
    queue.done = undefined;
    const sends: Promise<void>[] = [];
    while (queue.items.length > 0) {
      sends.push(track(send(destination, queue.items.splice(0, destination.size))));
    }
    const all = Promise.all(sends).then(() => undefined);
    if (done) void all.then(done);
    return all;
  }

  function enqueue(ctx: Context, destination: ResolvedDestination, item: unknown) {
    const queue = queues.get(destination.name);
    if (!queue) return;
    queue.items.push(item);
    if (
      queue.items.length >= destination.size ||
      (destination.wait === 0 && destination.size === 1)
    ) {
      void drain(destination);
      return;
    }
    if (queue.timer) return;
    // The request that starts a batch keeps it alive (e.g. `waitUntil`
    // with `advanced.backgroundTasks`) until the batch is sent.
    ctx.runInBackground(
      new Promise<void>((resolve) => {
        queue.done = resolve;
      }),
    );
    queue.timer = setTimeout(() => void drain(destination), destination.wait);
  }

  async function prepare(ctx: Context, destination: ResolvedDestination, event: AuditEvent) {
    let item: unknown = event;
    if (destination.transform) {
      try {
        item = await destination.transform(event);
      } catch (error) {
        fail(destination, error);
        return;
      }
      if (item === null || item === undefined) return;
    }
    enqueue(ctx, destination, item);
  }

  /** Hands a stored event to every matching destination. Returns at once. */
  function dispatch(ctx: Context, event: AuditEvent): void {
    logger = ctx.logger;
    for (const destination of destinations) {
      if (destination.events && !destination.events(event.type)) continue;
      ctx.runInBackground(track(prepare(ctx, destination, event)));
    }
  }

  /** Sends every queued event now and waits for every running `send`. */
  async function flush(): Promise<void> {
    while (pending.size > 0) await Promise.all([...pending]);
    await Promise.all(destinations.map((destination) => drain(destination)));
    while (pending.size > 0) await Promise.all([...pending]);
  }

  return { dispatch, flush, enabled: destinations.length > 0 };
}
