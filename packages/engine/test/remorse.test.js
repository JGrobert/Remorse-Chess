import assert from "node:assert/strict";
import test from "node:test";
import { RemorseChessEngine } from "../dist/index.js";

const engine = new RemorseChessEngine();
const noCastling = {
  white: { kingSide: false, queenSide: false },
  black: { kingSide: false, queenSide: false },
};

function piece(id, color, type, square, status) {
  return { id, color, type, square, ...(status ? { status } : {}) };
}

function position(pieces, activeColor = "white", extras = {}) {
  return {
    matchId: "fixture",
    revision: 0,
    position: {
      pieces,
      activeColor,
      castlingRights: noCastling,
      enPassantSquare: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
      ...extras,
    },
    phase: { kind: "active" },
    lastRoll: null,
  };
}

function rookCapture(extraPieces = [], rookStatus) {
  return position([
    piece("wk", "white", "king", "h1"),
    piece("bk", "black", "king", "h8"),
    piece("wr", "white", "rook", "a1", rookStatus),
    piece("bp", "black", "pawn", "a7"),
    ...extraPieces,
  ]);
}

function captureAndRoll(state, face) {
  const pending = engine.applyAction(state, "white", { type: "move", move: { from: "a1", to: "a7" } });
  assert.equal(pending.phase.kind, "awaiting-roll");
  return engine.applyAction(pending, "white", { type: "resolve-roll", captureId: pending.phase.capture.id, face });
}

test("each non-king die face maps to the specified status", () => {
  const expected = new Map([
    [1, ["devastated", 3]], [2, ["guilty", 3]], [3, ["guilty", 3]],
    [4, [undefined, undefined]], [5, [undefined, undefined]], [6, ["psycho", 3]],
  ]);
  for (const face of [1, 2, 3, 4, 5, 6]) {
    const state = captureAndRoll(rookCapture(), face);
    const status = state.position.pieces.find(({ id }) => id === "wr")?.status;
    assert.equal(status?.kind, expected.get(face)[0], `face ${face}`);
    assert.equal(status?.remainingTurns, expected.get(face)[1], `face ${face}`);
    assert.equal(state.position.activeColor, "black");
    assert.equal(state.phase.kind, "active");
    assert.equal(state.lastRoll.face, face);
  }
});
test("a king only gains or refreshes Psycho on six; other faces preserve its timer then count it down", () => {
  for (const face of [1, 2, 3, 4, 5, 6]) {
    const state = position([
      piece("wk", "white", "king", "e4", { kind: "psycho", remainingTurns: 2 }),
      piece("bk", "black", "king", "h8"),
      piece("bp", "black", "pawn", "d5"),
    ]);
    const pending = engine.applyAction(state, "white", { type: "move", move: { from: "e4", to: "d5" } });
    const settled = engine.applyAction(pending, "white", {
      type: "resolve-roll", captureId: pending.phase.capture.id, face,
    });
    const status = settled.position.pieces.find(({ id }) => id === "wk").status;
    assert.deepEqual(status, {
      kind: "psycho",
      remainingTurns: face === 6 ? 3 : 1,
    }, `face ${face}`);
    assert.equal(settled.lastRoll.effect, face === 6 ? "psycho" : "none");
  }
});

test("Guilty sliders cannot capture or pass an occupied blocker", () => {
  const state = position([
    piece("wk", "white", "king", "h1"), piece("bk", "black", "king", "h8"),
    piece("wr", "white", "rook", "a1", { kind: "guilty", remainingTurns: 3 }),
    piece("bp", "black", "pawn", "a4"),
  ]);
  const moves = engine.getLegalMoves(state, "wr");
  assert.ok(moves.includes("a2"));
  assert.ok(moves.includes("a3"));
  assert.ok(!moves.includes("a4"));
  assert.ok(!moves.includes("a5"));
});

test("Guilty pieces do not give check", () => {
  const state = position([
    piece("wk", "white", "king", "e1"), piece("bk", "black", "king", "a8"),
    piece("br", "black", "rook", "e8", { kind: "guilty", remainingTurns: 2 }),
  ]);
  assert.ok(engine.getLegalMoves(state, "wk").includes("e2"));
});

test("a bishop landing rescues adjacent friendly Devastated and Guilty pieces", () => {
  const state = position([
    piece("wk", "white", "king", "a1"), piece("bk", "black", "king", "h8"),
    piece("wb", "white", "bishop", "b2"),
    piece("dev", "white", "pawn", "d4", { kind: "devastated", remainingTurns: 1 }),
    piece("guilt", "white", "knight", "c4", { kind: "guilty", remainingTurns: 2 }),
  ]);
  const next = engine.applyAction(state, "white", { type: "move", move: { from: "b2", to: "c3" } });
  assert.equal(next.position.pieces.find(({ id }) => id === "dev").status, undefined);
  assert.equal(next.position.pieces.find(({ id }) => id === "guilt").status, undefined);
});

test("stationary and enemy bishops do not rescue a piece", () => {
  for (const bishopColor of ["white", "black"]) {
    const state = position([
      piece("wk", "white", "king", "h1"), piece("bk", "black", "king", "h8"),
      piece("bishop", bishopColor, "bishop", "c3"),
      piece("dev", "white", "pawn", "d4", { kind: "devastated", remainingTurns: 1 }),
      piece("wn", "white", "knight", "a2"),
    ]);
    const next = engine.applyAction(state, "white", { type: "move", move: { from: "a2", to: "b4" } });
    assert.equal(next.position.pieces.some(({ id }) => id === "dev"), false, "expired Devastated piece is removed");
  }
});

test("Devastated status expires after exactly three later turn settlements", () => {
  let state = captureAndRoll(rookCapture(), 1);
  assert.equal(state.position.pieces.find(({ id }) => id === "wr").status.remainingTurns, 3);
  state = engine.applyAction(state, "black", { type: "move", move: { from: "h8", to: "g8" } });
  assert.equal(state.position.pieces.find(({ id }) => id === "wr").status.remainingTurns, 2);
  state = engine.applyAction(state, "white", { type: "move", move: { from: "h1", to: "g1" } });
  assert.equal(state.position.pieces.find(({ id }) => id === "wr").status.remainingTurns, 1);
  state = engine.applyAction(state, "black", { type: "move", move: { from: "g8", to: "h8" } });
  assert.equal(state.position.pieces.some(({ id }) => id === "wr"), false);
});

test("Guilty clears at expiry, while an expiring Devastated home rook loses castling rights", () => {
  const state = position([
    piece("wk", "white", "king", "e1"), piece("bk", "black", "king", "e8"),
    piece("wr", "white", "rook", "a1", { kind: "devastated", remainingTurns: 1 }),
    piece("bn", "black", "knight", "b8"),
  ], "white", { castlingRights: { white: { kingSide: false, queenSide: true }, black: noCastling.black } });
  const next = engine.applyAction(state, "white", { type: "move", move: { from: "e1", to: "f1" } });
  assert.equal(next.position.pieces.some(({ id }) => id === "wr"), false);
  assert.equal(next.position.castlingRights.white.queenSide, false);
});

test("expiration may expose the next player's king without ending the game", () => {
  const state = position([
    piece("wk", "white", "king", "e1"), piece("bk", "black", "king", "a8"),
    piece("wr", "white", "rook", "e2", { kind: "devastated", remainingTurns: 1 }),
    piece("br", "black", "rook", "e8"),
  ], "black");
  const next = engine.applyAction(state, "black", { type: "move", move: { from: "a8", to: "b8" } });
  assert.equal(next.phase.kind, "active");
  assert.equal(next.position.activeColor, "white");
  assert.ok(engine.getLegalMoves(next, "wk").length > 0);
});

test("expiration exposing the mover's king loses the game", () => {
  const state = position([
    piece("wk", "white", "king", "e1"), piece("bk", "black", "king", "a8"),
    piece("wr", "white", "rook", "e2", { kind: "devastated", remainingTurns: 1 }),
    piece("br", "black", "rook", "e8"), piece("wn", "white", "knight", "a1"),
  ]);
  const next = engine.applyAction(state, "white", { type: "move", move: { from: "a1", to: "b3" } });
  assert.deepEqual(next.phase, { kind: "finished", result: { kind: "win", winner: "black", reason: "king-exposed" } });
});

test("a newly rolled six grants one same-turn Psycho capture without a second roll", () => {
  const pending = engine.applyAction(rookCapture([piece("bn", "black", "knight", "b7")]), "white", {
    type: "move", move: { from: "a1", to: "a7" },
  });
  const bonus = engine.applyAction(pending, "white", { type: "resolve-roll", captureId: pending.phase.capture.id, face: 6 });
  assert.equal(bonus.phase.kind, "awaiting-bonus");
  const settled = engine.applyAction(bonus, "white", { type: "bonus-move", move: { from: "a7", to: "b7" } });
  assert.equal(settled.phase.kind, "active");
  assert.equal(settled.position.activeColor, "black");
  assert.equal(settled.position.pieces.find(({ id }) => id === "wr").square, "b7");
  assert.equal(settled.position.pieces.find(({ id }) => id === "wr").status.kind, "psycho");
  assert.equal(settled.lastRoll.face, 6);
});

test("a pre-existing Psycho piece may skip its bonus; the first roll applies only at settlement", () => {
  const pending = engine.applyAction(rookCapture([piece("bn", "black", "knight", "b7")], { kind: "psycho", remainingTurns: 2 }), "white", {
    type: "move", move: { from: "a1", to: "a7" },
  });
  const bonus = engine.applyAction(pending, "white", { type: "resolve-roll", captureId: pending.phase.capture.id, face: 1 });
  assert.equal(bonus.phase.kind, "awaiting-bonus");
  assert.deepEqual(bonus.position.pieces.find(({ id }) => id === "wr").status, { kind: "psycho", remainingTurns: 2 });
  const settled = engine.applyAction(bonus, "white", { type: "skip-bonus" });
  assert.equal(settled.phase.kind, "active");
  assert.deepEqual(settled.position.pieces.find(({ id }) => id === "wr").status, { kind: "devastated", remainingTurns: 3 });
  assert.equal(settled.lastRoll.face, 1);
});

test("a Psycho bonus must capture with the same piece and never opens a third capture or roll", () => {
  const pending = engine.applyAction(rookCapture([piece("bn", "black", "knight", "b7")], { kind: "psycho", remainingTurns: 3 }), "white", {
    type: "move", move: { from: "a1", to: "a7" },
  });
  const bonus = engine.applyAction(pending, "white", { type: "resolve-roll", captureId: pending.phase.capture.id, face: 2 });
  assert.ok(engine.getLegalMoves(bonus, "wr").includes("b7"));
  assert.equal(engine.getLegalMoves(bonus, "wk").length, 0);
  assert.throws(() => engine.applyAction(bonus, "white", { type: "bonus-move", move: { from: "h1", to: "h2" } }), /same capturing piece/i);
  assert.throws(() => engine.applyAction(bonus, "white", { type: "bonus-move", move: { from: "a7", to: "a6" } }), /must capture/i);
  const settled = engine.applyAction(bonus, "white", { type: "bonus-move", move: { from: "a7", to: "b7" } });
  assert.equal(settled.phase.kind, "active");
  assert.equal(settled.lastRoll.face, 2);
  assert.deepEqual(settled.position.pieces.find(({ id }) => id === "wr").status, { kind: "guilty", remainingTurns: 3 });
  assert.throws(() => engine.applyAction(settled, "white", { type: "bonus-move", move: { from: "b7", to: "b8" } }), /resolving a capture|bonus/i);
});

test("promotion preserves Psycho identity and uses the promoted type for its bonus capture", () => {
  const state = position([
    piece("wk", "white", "king", "h1"), piece("bk", "black", "king", "h8"),
    piece("wp", "white", "pawn", "e7", { kind: "psycho", remainingTurns: 2 }),
    piece("br", "black", "rook", "d8"), piece("bp", "black", "pawn", "c8"),
  ]);
  const pending = engine.applyAction(state, "white", { type: "move", move: { from: "e7", to: "d8", promotion: "queen" } });
  const bonus = engine.applyAction(pending, "white", { type: "resolve-roll", captureId: pending.phase.capture.id, face: 3 });
  assert.equal(bonus.phase.kind, "awaiting-bonus");
  const settled = engine.applyAction(bonus, "white", { type: "bonus-move", move: { from: "d8", to: "c8" } });
  const promoted = settled.position.pieces.find(({ id }) => id === "wp");
  assert.equal(promoted.type, "queen");
  assert.equal(promoted.square, "c8");
  assert.deepEqual(promoted.status, { kind: "guilty", remainingTurns: 3 });
});

test("a Psycho king is not offered a bonus capture that moves it into check", () => {
  const state = position([
    piece("wk", "white", "king", "e4", { kind: "psycho", remainingTurns: 2 }),
    piece("bk", "black", "king", "h8"), piece("bp1", "black", "pawn", "d5"),
    piece("br2", "black", "rook", "c6"), piece("bb", "black", "bishop", "b7"),
  ]);
  const pending = engine.applyAction(state, "white", { type: "move", move: { from: "e4", to: "d5" } });
  const next = engine.applyAction(pending, "white", { type: "resolve-roll", captureId: pending.phase.capture.id, face: 4 });
  assert.equal(next.phase.kind, "active");
  assert.equal(next.position.activeColor, "black");
});

test("bare kings draw after a settled turn", () => {
  const state = position([
    piece("wk", "white", "king", "a1"), piece("bk", "black", "king", "h8"),
    piece("dev", "white", "bishop", "c3", { kind: "devastated", remainingTurns: 1 }),
  ]);
  const next = engine.applyAction(state, "white", { type: "move", move: { from: "a1", to: "a2" } });
  assert.deepEqual(next.phase, { kind: "finished", result: { kind: "draw", reason: "bare-kings" } });
});
