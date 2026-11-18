import assert from "node:assert/strict";
import test from "node:test";
import { RoomManager } from "../dist/rooms.js";

class EmptyEngine {
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

  getLegalMoves() { return []; }
  applyAction(state) { return { ...state, revision: state.revision + 1 }; }
}

function lobbyState(deliveries, socketId) {
  const delivery = deliveries.find((candidate) => candidate.socketId === socketId && candidate.event === "lobby-message");
  assert.equal(delivery?.message.type, "lobby-state");
  return delivery.message;
}

function enter(manager, socketId, displayName, guestToken) {
  const command = { type: "enter", displayName, ...(guestToken ? { guestToken } : {}) };
  return lobbyState(manager.handleLobbyCommand(socketId, command), socketId);
}

test("guest presence is opt-in and reconnect restores the same online identity", () => {
  const manager = new RoomManager(new EmptyEngine());
  const alice = enter(manager, "alice-socket", "Alice");
  assert.deepEqual(alice.online, []);

  const bobDeliveries = manager.handleLobbyCommand("bob-socket", { type: "enter", displayName: "Bob" });
  const bob = lobbyState(bobDeliveries, "bob-socket");
  assert.deepEqual(bob.online, [{ guestId: alice.self.guestId, displayName: "Alice" }]);
  assert.deepEqual(lobbyState(bobDeliveries, "alice-socket").online,
    [{ guestId: bob.self.guestId, displayName: "Bob" }]);

  const disconnected = manager.disconnect("alice-socket");
  assert.deepEqual(lobbyState(disconnected, "bob-socket").online, []);
  const resumed = manager.handleLobbyCommand("alice-reconnected", {
    type: "enter", displayName: "Alice", guestToken: alice.self.guestToken,
  });
  const resumedAlice = lobbyState(resumed, "alice-reconnected");
  assert.equal(resumedAlice.self.guestId, alice.self.guestId);
  assert.deepEqual(lobbyState(resumed, "bob-socket").online,
    [{ guestId: alice.self.guestId, displayName: "Alice" }]);
});

test("guests can decline or accept challenges into the same private room flow", () => {
  const manager = new RoomManager(new EmptyEngine());
  const alice = enter(manager, "alice-socket", "Alice");
  const bob = enter(manager, "bob-socket", "Bob");
  enter(manager, "carol-socket", "Carol");

  const first = manager.handleLobbyCommand("alice-socket", {
    type: "challenge", guestToken: alice.self.guestToken, targetGuestId: bob.self.guestId,
  });
  const firstChallenge = lobbyState(first, "bob-socket").incoming[0];
  assert.equal(firstChallenge.fromName, "Alice");
  assert.equal(lobbyState(first, "alice-socket").outgoing[0].toName, "Bob");

  const declined = manager.handleLobbyCommand("bob-socket", {
    type: "respond", guestToken: bob.self.guestToken, challengeId: firstChallenge.challengeId, accept: false,
  });
  assert.deepEqual(lobbyState(declined, "alice-socket").outgoing, []);
  assert.deepEqual(lobbyState(declined, "bob-socket").incoming, []);

  const second = manager.handleLobbyCommand("alice-socket", {
    type: "challenge", guestToken: alice.self.guestToken, targetGuestId: bob.self.guestId,
  });
  const challenge = lobbyState(second, "bob-socket").incoming[0];
  const accepted = manager.handleLobbyCommand("bob-socket", {
    type: "respond", guestToken: bob.self.guestToken, challengeId: challenge.challengeId, accept: true,
  });
  const created = accepted.find((delivery) => delivery.socketId === "alice-socket" && delivery.message.type === "room-created");
  const joined = accepted.find((delivery) => delivery.socketId === "bob-socket" && delivery.message.type === "room-joined");
  const ready = accepted.find((delivery) => delivery.socketId === "alice-socket"
    && delivery.event === "message" && delivery.message.type === "state");
  assert.ok(created);
  assert.ok(joined);
  assert.ok(ready);
  assert.equal(created.message.roomId, joined.message.roomId);
  assert.deepEqual(manager.getConnectedSocketIds(created.message.roomId).sort(), ["alice-socket", "bob-socket"]);
  const carolState = lobbyState(accepted, "carol-socket");
  assert.deepEqual(carolState.online, []);
});

test("players who enter private rooms disappear from the opt-in guest directory", () => {
  const manager = new RoomManager(new EmptyEngine());
  const alice = enter(manager, "alice-socket", "Alice");
  const bob = enter(manager, "bob-socket", "Bob");

  const created = manager.handleSession("alice-socket", { type: "create-room" });
  assert.equal(created.type, "room-created");
  assert.deepEqual(lobbyState(manager.getLobbyStateDeliveries(), "bob-socket").online, []);
  const joined = manager.handleSession("bob-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");
  assert.deepEqual(manager.getLobbyStateDeliveries(), []);

  const outsider = enter(manager, "carol-socket", "Carol");
  assert.deepEqual(outsider.online, []);
  assert.equal(outsider.online.some((guest) => guest.guestId === alice.self.guestId
    || guest.guestId === bob.self.guestId), false);
});

test("a guest token cannot be used from a different connection", () => {
  const manager = new RoomManager(new EmptyEngine());
  const alice = enter(manager, "alice-socket", "Alice");
  const forged = manager.handleLobbyCommand("intruder-socket", {
    type: "challenge", guestToken: alice.self.guestToken, targetGuestId: "anything",
  });
  assert.equal(forged[0].message.type, "lobby-error");
  assert.equal(forged[0].message.code, "not-in-lobby");
  assert.deepEqual(lobbyState(manager.getLobbyStateDeliveries(), "alice-socket").online, []);
});
