import assert from "node:assert/strict";
import test from "node:test";
import { getCaptureDestinations, getDisplaySquares, getLegalDestinations } from "../src/rules.js";
import { previewSnapshot } from "../src/fixtures.js";

const rights = {
  white: { kingSide: false, queenSide: false },
  black: { kingSide: false, queenSide: false },
};

function position(pieces, extras = {}) {
  return {
    matchId: "ui-test",
    revision: 0,
    position: {
      pieces: [
        { id: "wk", color: "white", type: "king", square: "e1" },
        { id: "bk", color: "black", type: "king", square: "e8" },
        ...pieces,
      ],
      activeColor: "white",
      castlingRights: rights,
      enPassantSquare: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
      ...extras,
    },
    phase: { kind: "active" },
    lastRoll: null,
  };
}

test("orientation lists White's home rank at the bottom and flips for Black", () => {
  const white = getDisplaySquares("white");
  const black = getDisplaySquares("black");
  assert.equal(white[0], "a8");
  assert.equal(white[56], "a1");
  assert.equal(black[0], "h1");
  assert.equal(black[56], "h8");
});

test("pawns expose one and two square advances when the path is clear", () => {
  const state = position([{ id: "wp", color: "white", type: "pawn", square: "e2" }]);
  assert.deepEqual(getLegalDestinations(state, "wp").sort(), ["e3", "e4"]);
});

test("sliders stop on the first occupied square", () => {
  const state = position([
    { id: "wr", color: "white", type: "rook", square: "a4" },
    { id: "bp", color: "black", type: "pawn", square: "a6" },
    { id: "wp", color: "white", type: "pawn", square: "c4" },
  ]);
  const moves = getLegalDestinations(state, "wr");
  assert(moves.includes("a5"));
  assert(moves.includes("a6"));
  assert(!moves.includes("a7"));
  assert(!moves.includes("c4"));
});

test("Guilty pieces keep ordinary movement but cannot capture", () => {
  const state = position([
    { id: "wn", color: "white", type: "knight", square: "d4", status: { kind: "guilty", remainingTurns: 2 } },
    { id: "bp", color: "black", type: "pawn", square: "e6" },
  ]);
  const moves = getLegalDestinations(state, "wn");
  assert(moves.includes("f5"));
  assert(!moves.includes("e6"));
  assert.deepEqual(getCaptureDestinations(state, "wn"), []);
});

test("Psycho bonus UI destinations include captures only", () => {
  const state = {
    ...previewSnapshot,
    position: {
      ...previewSnapshot.position,
      pieces: [
        ...previewSnapshot.position.pieces,
        { id: "bonus-target", color: "black", type: "pawn", square: "g6" },
      ],
    },
    phase: {
      kind: "awaiting-bonus",
      player: "white",
      capture: { id: "capture-1", capturingPieceId: "white-queen", capturedPieceId: "p", from: "e3", to: "e4" },
      roll: { face: 2, effect: "guilty", pieceId: "white-queen" },
    },
  };
  const captures = getCaptureDestinations(state, "white-queen");
  assert(captures.includes("g6"));
  assert(!captures.includes("d4"));
});
