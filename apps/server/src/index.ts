import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { RemorseChessEngine } from "@remorse-chess/engine";
import type { ClientActionEnvelope, LobbyCommand, SessionCommand } from "@remorse-chess/protocol";
import { RoomManager } from "./rooms.js";

export { RoomManager } from "./rooms.js";
export type { ActionSubmission, LobbyDelivery, RoomManagerOptions } from "./rooms.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function createHttpServer(): ReturnType<typeof createServer> {
  const defaultWebDirectory = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const webDirectory = resolve(process.env.WEB_DIST_DIR ?? defaultWebDirectory);

  return createServer(async (request, response) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }

    if (pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    // Socket.IO registers its own request handler on this same HTTP server.
    if (pathname.startsWith("/socket.io")) return;

    const relativePath = pathname.replace(/^[/\\]+/, "");
    const target = resolve(webDirectory, relativePath);
    if (target !== webDirectory && !target.startsWith(`${webDirectory}${sep}`)) {
      response.writeHead(400).end("Bad request");
      return;
    }

    let filePath = target;
    try {
      if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, "index.html");
    } catch {
      // Routes such as /invite/abc are served by the client application's entry point.
      if (extname(pathname)) {
        response.writeHead(404).end("Not found");
        return;
      }
      filePath = resolve(webDirectory, "index.html");
    }

    if (filePath !== webDirectory && !filePath.startsWith(`${webDirectory}${sep}`)) {
      response.writeHead(400).end("Bad request");
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Client build not found");
    }
  });
}

export function attachRealtimeServer(httpServer: ReturnType<typeof createServer>, manager = new RoomManager(new RemorseChessEngine())): Server {
  const io = new Server(httpServer, { cors: { origin: false } });
  const deliverLobby = (deliveries: ReturnType<RoomManager["getLobbyStateDeliveries"]>) => {
    for (const delivery of deliveries) io.to(delivery.socketId).emit(delivery.event, delivery.message);
  };

  io.on("connection", (socket) => {
    socket.on("session", (command: SessionCommand) => {
      const message = manager.handleSession(socket.id, command);
      socket.emit("message", message);
      deliverLobby(manager.getLobbyStateDeliveries());
      if (message.type === "room-joined") {
        const readyMessage = { type: "state" as const, state: message.state };
        for (const socketId of manager.getConnectedSocketIds(message.roomId)) {
          if (socketId !== socket.id) io.to(socketId).emit("message", readyMessage);
        }
      }
    });

    socket.on("lobby", (command: LobbyCommand) => {
      deliverLobby(manager.handleLobbyCommand(socket.id, command));
    });

    socket.on("action", async (envelope: ClientActionEnvelope) => {
      const submission = await manager.submitAction(socket.id, envelope);
      if (submission.broadcast && submission.message.type === "state") {
        for (const socketId of manager.getConnectedSocketIds(submission.message.state.matchId)) {
          io.to(socketId).emit("message", submission.message);
        }
      } else {
        socket.emit("message", submission.message);
      }
    });

    socket.on("disconnect", () => deliverLobby(manager.disconnect(socket.id)));
  });

  return io;
}

const port = Number(process.env.PORT ?? 8080);
if (process.env.NODE_ENV !== "test") {
  const httpServer = createHttpServer();
  attachRealtimeServer(httpServer);
  httpServer.listen(port, "0.0.0.0", () => {
    process.stdout.write(`Remorse Chess server listening on ${port}\n`);
  });
}
