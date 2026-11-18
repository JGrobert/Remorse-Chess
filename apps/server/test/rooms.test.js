import assert from "node:assert/strict";
import test from "node:test";
import { RoomManager } from "../dist/rooms.js";

function makeSnapshot(matchId, revision = 0) {
  return {
    matchId,
    revision,
    position: {
      pieces: [
        { id: "white-king", color: "white", type: "king", square: "e1" },
        { id: "black-king", color: "black", type: "king", square: "e8" },
      ],
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

class MockEngine {
  calls = 0;

  createInitialGame(matchId) {
    return makeSnapshot(matchId);
  }

  getLegalMoves() {
    return [];
  }

  applyAction(state, actor, action) {
    this.calls += 1;
    if (state.phase.kind === "finished") throw new Error("The game is finished");
    if (action.type === "resign") {
      return {
        ...state,
        revision: state.revision + 1,
        phase: { kind: "finished", result: { kind: "win", winner: actor === "white" ? "black" : "white", reason: "resignation" } },
      };
    }
    if (action.type === "move") {
      if (state.position.activeColor !== actor) throw new Error("It is not this player's turn");
      return {
        ...state,
        revision: state.revision + 1,
        phase: {
          kind: "awaiting-roll",
          player: actor,
          capture: {
            id: `capture-${state.revision + 1}`,
            capturingPieceId: `${actor}-pawn-a`,
            capturedPieceId: `${actor === "white" ? "black" : "white"}-pawn-b`,
            from: action.move.from,
            to: action.move.to,
          },
        },
      };
    }
    if (action.type === "resolve-roll") {
      if (state.phase.kind !== "awaiting-roll" || state.phase.capture.id !== action.captureId) {
        throw new Error("No matching capture is awaiting a roll");
      }
      const effect = action.face <= 3 ? (action.face === 1 ? "devastated" : "guilty") : action.face === 6 ? "psycho" : "none";
      return {
        ...state,
        revision: state.revision + 1,
        position: { ...state.position, activeColor: actor === "white" ? "black" : "white" },
        phase: { kind: "active" },
        lastRoll: { face: action.face, effect, pieceId: state.phase.capture.capturingPieceId },
      };
    }
    if (action.type === "bonus-move" || action.type === "skip-bonus") {
      return {
        ...state,
        revision: state.revision + 1,
        position: { ...state.position, activeColor: actor === "white" ? "black" : "white" },
        phase: { kind: "active" },
      };
    }
    throw new Error(`Unsupported mock action ${action.type}`);
  }
}

function setup(options = {}) {
  const engine = new MockEngine();
  const manager = new RoomManager(engine, options);
  const created = manager.handleSession("white-socket", { type: "create-room" });
  assert.equal(created.type, "room-created");
  return { engine, manager, created };
}

const moveEnvelope = (actionId, expectedRevision = 0) => ({
  actionId,
  expectedRevision,
  command: { type: "move", move: { from: "a2", to: "a4" } },
});

test("private invite assigns one black seat and never grants an occupied seat", () => {
  const { manager, created } = setup();
  const joined = manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");
  if (joined.type !== "room-joined") return;
  assert.equal(joined.color, "black");
  assert.notEqual(joined.seatToken, created.seatToken);
  assert.equal(manager.handleSession("third-socket", { type: "join-room", inviteCode: created.inviteCode }).type, "error");
  assert.equal(manager.handleSession("intruder", {
    type: "rejoin-room", roomId: created.roomId, seatToken: joined.seatToken,
  }).type, "error");
  assert.equal(manager.handleSession("black-socket", { type: "request-snapshot", roomId: created.roomId }).type, "state");
  assert.equal(manager.handleSession("intruder", { type: "request-snapshot", roomId: created.roomId }).type, "error");
});

test("one connection cannot occupy both seats and only the active seat can move", async () => {
  const { manager, created, engine } = setup();
  const selfJoin = manager.handleSession("white-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(selfJoin.type, "error");
  const joined = manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");

  const wrongSeat = await manager.submitAction("black-socket", moveEnvelope("black-first"));
  assert.equal(wrongSeat.message.type, "error");
  if (wrongSeat.message.type === "error") assert.equal(wrongSeat.message.code, "not-your-turn");
  assert.equal(engine.calls, 0);

  const stranger = await manager.submitAction("stranger", moveEnvelope("unauthorized"));
  assert.equal(stranger.message.type, "error");
  if (stranger.message.type === "error") assert.equal(stranger.message.code, "room-unavailable");
  assert.equal(engine.calls, 0);
});

test("stale actions are rejected and duplicate accepted IDs do not execute twice", async () => {
  const { manager, engine, created } = setup();
  manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  const first = await manager.submitAction("white-socket", moveEnvelope("move-1"));
  assert.equal(first.message.type, "state");
  assert.equal(first.broadcast, true);
  const duplicate = await manager.submitAction("white-socket", moveEnvelope("move-1"));
  assert.deepEqual(duplicate.message, first.message);
  assert.equal(duplicate.broadcast, false);
  assert.equal(engine.calls, 1);
  const stale = await manager.submitAction("white-socket", moveEnvelope("move-2"));
  assert.equal(stale.message.type, "error");
  if (stale.message.type === "error") assert.equal(stale.message.code, "stale-revision");
  assert.equal(engine.calls, 1);
});

test("moves wait until Black claims the invited seat", async () => {
  const { manager, created } = setup();
  const waiting = await manager.submitAction("white-socket", moveEnvelope("early-move"));
  assert.equal(waiting.message.type, "error");
  if (waiting.message.type === "error") {
    assert.equal(waiting.message.code, "room-unavailable");
    assert.match(waiting.message.message, /second player/i);
  }
  const joined = manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");
  const started = await manager.submitAction("white-socket", moveEnvelope("move-after-join"));
  assert.equal(started.message.type, "state");
});

test("the server generates one roll and returns its stored result on retries", async () => {
  let rollCount = 0;
  const { manager, created } = setup({ randomFace: () => { rollCount += 1; return 6; } });
  manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  await manager.submitAction("white-socket", moveEnvelope("capture"));
  const firstRoll = await manager.submitAction("white-socket", {
    actionId: "roll-first",
    expectedRevision: 1,
    command: { type: "request-roll" },
  });
  assert.equal(firstRoll.broadcast, true);
  assert.equal(firstRoll.message.type, "state");
  assert.equal(rollCount, 1);
  const duplicateId = await manager.submitAction("white-socket", {
    actionId: "roll-first",
    expectedRevision: 1,
    command: { type: "request-roll" },
  });
  assert.deepEqual(duplicateId.message, firstRoll.message);
  const retryId = await manager.submitAction("white-socket", {
    actionId: "roll-retry",
    expectedRevision: 1,
    command: { type: "request-roll" },
  });
  assert.deepEqual(retryId.message, firstRoll.message);
  assert.equal(retryId.broadcast, false);
  assert.equal(rollCount, 1);
});

test("a roll receipt expires after another accepted action", async () => {
  let rollCount = 0;
  const { manager, created } = setup({ randomFace: () => { rollCount += 1; return 4; } });
  const joined = manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");
  await manager.submitAction("white-socket", moveEnvelope("white-capture"));
  const firstRoll = await manager.submitAction("white-socket", {
    actionId: "white-roll",
    expectedRevision: 1,
    command: { type: "request-roll" },
  });
  assert.equal(firstRoll.message.type, "state");
  await manager.submitAction("black-socket", moveEnvelope("black-capture", 2));

  const staleRetry = await manager.submitAction("white-socket", {
    actionId: "white-delayed-retry",
    expectedRevision: 3,
    command: { type: "request-roll" },
  });
  assert.equal(staleRetry.message.type, "error");
  if (staleRetry.message.type === "error") assert.equal(staleRetry.message.code, "not-your-turn");
  assert.equal(rollCount, 1);
});

test("both seated clients are notified through one authoritative state response", async () => {
  const { manager, created } = setup();
  const joined = manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");
  const moved = await manager.submitAction("white-socket", moveEnvelope("capture"));
  assert.equal(moved.message.type, "state");
  assert.deepEqual(manager.getConnectedSocketIds(created.roomId).sort(), ["black-socket", "white-socket"]);
  const observer = manager.handleSession("black-socket", { type: "request-snapshot", roomId: created.roomId });
  assert.deepEqual(observer, moved.message);
});

test("disconnect preserves the pending phase for rejoin; both offline deletes the invite", async () => {
  const { manager, created } = setup();
  const joined = manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");
  assert.equal(joined.type === "room-joined" ? joined.color : undefined, "black");

  await manager.submitAction("white-socket", moveEnvelope("pending-capture"));
  const beforeDisconnect = manager.handleSession("white-socket", { type: "request-snapshot", roomId: created.roomId });
  manager.disconnect("white-socket");
  assert.equal(manager.roomCount, 1);
  const rejectedOccupied = manager.handleSession("replacement", {
    type: "rejoin-room", roomId: created.roomId, seatToken: created.seatToken,
  });
  assert.equal(rejectedOccupied.type, "room-joined");
  manager.disconnect("replacement");
  const resumed = manager.handleSession("white-reconnected", {
    type: "rejoin-room", roomId: created.roomId, seatToken: created.seatToken,
  });
  assert.equal(resumed.type, "room-joined");
  assert.deepEqual(resumed.type === "room-joined" ? resumed.state : undefined,
    beforeDisconnect.type === "state" ? beforeDisconnect.state : undefined);

  manager.disconnect("white-reconnected");
  manager.disconnect("black-socket");
  assert.equal(manager.roomCount, 0);
  assert.equal(manager.handleSession("late-guest", { type: "join-room", inviteCode: created.inviteCode }).type, "error");
});

test("either seat can resign during a pending roll without resolving that roll", async () => {
  const { manager, created } = setup();
  const joined = manager.handleSession("black-socket", { type: "join-room", inviteCode: created.inviteCode });
  assert.equal(joined.type, "room-joined");
  await manager.submitAction("white-socket", moveEnvelope("capture"));
  const result = await manager.submitAction("black-socket", {
    actionId: "resign",
    expectedRevision: 1,
    command: { type: "resign" },
  });
  assert.equal(result.message.type, "state");
  assert.equal(result.broadcast, true);
  if (result.message.type === "state") {
    assert.deepEqual(result.message.state.phase, {
      kind: "finished", result: { kind: "win", winner: "white", reason: "resignation" },
    });
  }
});

test("guest commands are rate limited", () => {
  const engine = new MockEngine();
  const manager = new RoomManager(engine, { rateLimit: { maxCommands: 1, windowMs: 10_000 } });
  assert.equal(manager.handleSession("socket", { type: "create-room" }).type, "room-created");
  const limited = manager.handleSession("socket", { type: "request-snapshot", roomId: "anything" });
  assert.equal(limited.type, "error");
  if (limited.type === "error") assert.match(limited.message, /too many/i);
});
