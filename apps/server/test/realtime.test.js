import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { io as createSocketClient } from "socket.io-client";
import { RoomManager } from "../dist/rooms.js";

process.env.NODE_ENV = "test";
const { attachRealtimeServer } = await import("../dist/index.js");

function waitForMessage(socket, predicate, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for server message"));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function waitForLobbyMessage(socket, predicate, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("lobby-message", onMessage);
      reject(new Error("Timed out waiting for lobby message"));
    }, timeoutMs);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("lobby-message", onMessage);
      resolve(message);
    };
    socket.on("lobby-message", onMessage);
  });
}

class TransportEngine {
  createInitialGame(matchId) {
    return {
      matchId,
      revision: 0,
      position: {
        pieces: [],
        activeColor: "white",
        castlingRights: {
          white: { kingSide: false, queenSide: false },
          black: { kingSide: false, queenSide: false },
        },
        enPassantSquare: null,
        halfmoveClock: 0,
        fullmoveNumber: 1,
      },
      phase: { kind: "active" },
      lastRoll: null,
    };
  }

  getLegalMoves() {
    return [];
  }

  applyAction(state, actor, action) {
    if (action.type !== "resign" && actor !== state.position.activeColor) {
      throw new Error("It is not this player's turn");
    }
    return {
      ...state,
      revision: state.revision + 1,
      position: { ...state.position, activeColor: actor === "white" ? "black" : "white" },
    };
  }
}

test("two Socket.IO clients receive the same authoritative state snapshot", { timeout: 15_000 }, async () => {
  const httpServer = createServer();
  const ioServer = attachRealtimeServer(httpServer, new RoomManager(new TransportEngine()));
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const white = createSocketClient(url, { reconnection: false });
  const black = createSocketClient(url, { reconnection: false });
  try {
    await Promise.all([
      waitForConnect(white),
      waitForConnect(black),
    ]);
    const createdPromise = waitForMessage(white, (message) => message.type === "room-created");
    white.emit("session", { type: "create-room" });
    const created = await createdPromise;
    const readyPromise = waitForMessage(white, (message) => message.type === "state");
    const joinedPromise = waitForMessage(black, (message) => message.type === "room-joined");
    black.emit("session", { type: "join-room", inviteCode: created.inviteCode });
    await joinedPromise;
    assert.deepEqual(await readyPromise, { type: "state", state: created.state });

    const whiteSnapshot = waitForMessage(white, (message) => message.type === "state");
    const blackSnapshot = waitForMessage(black, (message) => message.type === "state");
    white.emit("action", {
      actionId: "move-1",
      expectedRevision: 0,
      command: { type: "move", move: { from: "e2", to: "e4" } },
    });
    const [whiteState, blackState] = await Promise.all([whiteSnapshot, blackSnapshot]);
    assert.deepEqual(whiteState, blackState);
    assert.equal(whiteState.state.revision, 1);
  } finally {
    white.disconnect();
    black.disconnect();
    await new Promise((resolve) => ioServer.close(resolve));
  }
});

test("lobby presence survives reconnect and an accepted challenge creates a private match", { timeout: 15_000 }, async () => {
  const httpServer = createServer();
  const ioServer = attachRealtimeServer(httpServer, new RoomManager(new TransportEngine()));
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  let alice = createSocketClient(url, { reconnection: false });
  const bob = createSocketClient(url, { reconnection: false });
  const observer = createSocketClient(url, { reconnection: false });
  try {
    await Promise.all([waitForConnect(alice), waitForConnect(bob), waitForConnect(observer)]);
    const aliceJoin = waitForLobbyMessage(alice, (message) => message.type === "lobby-state");
    alice.emit("lobby", { type: "enter", displayName: "Alice" });
    const aliceState = await aliceJoin;
    const bobJoin = waitForLobbyMessage(bob, (message) => message.type === "lobby-state");
    bob.emit("lobby", { type: "enter", displayName: "Bob" });
    const bobState = await bobJoin;
    assert.deepEqual(bobState.online, [{ guestId: aliceState.self.guestId, displayName: "Alice" }]);

    const bobAfterDisconnect = waitForLobbyMessage(bob, (message) => message.type === "lobby-state" && message.online.length === 0);
    alice.disconnect();
    await bobAfterDisconnect;

    alice = createSocketClient(url, { reconnection: false });
    await waitForConnect(alice);
    const aliceRejoined = waitForLobbyMessage(alice, (message) => message.type === "lobby-state");
    const bobAfterReconnect = waitForLobbyMessage(bob, (message) => message.type === "lobby-state"
      && message.online.some((guest) => guest.guestId === aliceState.self.guestId));
    alice.emit("lobby", {
      type: "enter", displayName: "Alice", guestToken: aliceState.self.guestToken,
    });
    const rejoinedAliceState = await aliceRejoined;
    await bobAfterReconnect;
    assert.equal(rejoinedAliceState.self.guestId, aliceState.self.guestId);

    const observerJoin = waitForLobbyMessage(observer, (message) => message.type === "lobby-state");
    observer.emit("lobby", { type: "enter", displayName: "Observer" });
    await observerJoin;

    const bobIncoming = waitForLobbyMessage(bob, (message) => message.type === "lobby-state" && message.incoming.length === 1);
    const aliceOutgoing = waitForLobbyMessage(alice, (message) => message.type === "lobby-state" && message.outgoing.length === 1);
    alice.emit("lobby", {
      type: "challenge", guestToken: rejoinedAliceState.self.guestToken, targetGuestId: bobState.self.guestId,
    });
    const [incoming, outgoing] = await Promise.all([bobIncoming, aliceOutgoing]);
    assert.equal(incoming.incoming[0].fromName, "Alice");
    assert.equal(outgoing.outgoing[0].toName, "Bob");

    const roomCreatedPromise = waitForMessage(alice, (message) => message.type === "room-created");
    const readyPromise = waitForMessage(alice, (message) => message.type === "state");
    const roomJoinedPromise = waitForMessage(bob, (message) => message.type === "room-joined");
    const observerState = waitForLobbyMessage(observer, (message) => message.type === "lobby-state" && message.online.length === 0);
    bob.emit("lobby", {
      type: "respond",
      guestToken: bobState.self.guestToken,
      challengeId: incoming.incoming[0].challengeId,
      accept: true,
    });
    const [created, ready, joined] = await Promise.all([roomCreatedPromise, readyPromise, roomJoinedPromise]);
    await observerState;
    assert.equal(created.roomId, joined.roomId);
    assert.deepEqual(ready.state, created.state);
  } finally {
    alice.disconnect();
    bob.disconnect();
    observer.disconnect();
    await new Promise((resolve) => ioServer.close(resolve));
  }
});

function waitForConnect(socket, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Timed out connecting Socket.IO client")), timeoutMs);
    const onConnect = () => finish();
    const onError = (error) => finish(new Error(`Socket.IO connection failed: ${error.message}`));
    const finish = (error) => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
      error ? reject(error) : resolve();
    };
    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}
