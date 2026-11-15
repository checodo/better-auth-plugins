// Deletes the playground database. Refuses while the playground runs: the
// server would keep the deleted file open and create a new, empty one.
import { rm } from "node:fs/promises";
import { connect } from "node:net";

const port = Number(process.env.PORT ?? 3001);
const running = await new Promise((resolve) => {
  const socket = connect({ port, host: "127.0.0.1" });
  socket.once("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => resolve(false));
});

if (running) {
  console.error(`Something is running on port ${port}. Stop the playground first, then reset.`);
  process.exit(1);
}

const files = ["playground.db", "playground.db-journal", "playground.db-wal", "playground.db-shm"];
await Promise.all(files.map((file) => rm(file, { force: true })));
console.log("Playground database deleted. It is created again on the next start.");
