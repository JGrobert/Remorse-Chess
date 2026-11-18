import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { StandardChessEngine } from "../dist/index.js";

const engine = new StandardChessEngine();
const pieceTypes = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

function snapshotFromFen(fen, matchId = "fen-position") {
  const [placement, activeColor, castling, enPassant, halfmoveClock, fullmoveNumber] = fen.split(" ");
  const pieces = [];
  const identities = new Map();
  const rows = placement.split("/");

  rows.forEach((row, fenRank) => {
    let file = 0;
    for (const symbol of row) {
      if (/\d/.test(symbol)) {
        file += Number(symbol);
        continue;
      }
      const color = symbol === symbol.toUpperCase() ? "white" : "black";
      const type = pieceTypes[symbol.toLowerCase()];
      const key = `${color}-${type}`;
      const count = (identities.get(key) ?? 0) + 1;
      identities.set(key, count);
      pieces.push({
        id: `${key}-${count}`,
        color,
        type,
        square: `${"abcdefgh"[file]}${8 - fenRank}`,
      });
      file += 1;
    }
  });

  return {
    matchId,
    revision: 0,
    position: {
      pieces,
      activeColor: activeColor === "w" ? "white" : "black",
      castlingRights: {
        white: { kingSide: castling.includes("K"), queenSide: castling.includes("Q") },
        black: { kingSide: castling.includes("k"), queenSide: castling.includes("q") },
      },
      enPassantSquare: enPassant === "-" ? null : enPassant,
      halfmoveClock: Number(halfmoveClock),
      fullmoveNumber: Number(fullmoveNumber),
    },
    phase: { kind: "active" },
    lastRoll: null,
  };
}

function sorted(values) {
  return [...values].sort();
}

const oraclePositions = [
  ["initial position", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"],
  ["black to move after a double pawn push", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"],
  ["open castling lanes", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"],
  ["castling through an attacked square", "r3k2r/8/8/1b6/8/8/8/R3K2R w KQkq - 0 1"],
  ["en passant", "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"],
  ["en passant exposing the king", "4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 1"],
  ["promotion choices", "4k3/P7/8/8/8/8/7p/4K3 w - - 0 1"],
  ["a pinned rook", "4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1"],
  ["king in check", "4k3/8/8/8/8/8/4r3/4K3 w - - 0 1"],
];

for (const [name, fen] of oraclePositions) {
  test(`legal moves match chess.js: ${name}`, () => {
    const state = snapshotFromFen(fen, name);
    const oracle = new Chess(fen);
    for (const piece of state.position.pieces.filter(({ color }) => color === state.position.activeColor)) {
      const expected = sorted(new Set(oracle.moves({ square: piece.square, verbose: true }).map(({ to }) => to)));
      const actual = sorted(engine.getLegalMoves(state, piece.id));
      assert.deepEqual(actual, expected, `${piece.color} ${piece.type} on ${piece.square}`);
    }
  });
}

test("initial game has the standard setup and twenty legal moves", () => {
  const state = engine.createInitialGame("initial");
  assert.equal(state.position.pieces.length, 32);
  assert.equal(new Set(state.position.pieces.map(({ id }) => id)).size, 32);
  assert.equal(state.position.pieces.reduce((sum, piece) => sum + engine.getLegalMoves(state, piece.id).length, 0), 20);
});

test("castling moves both pieces and consumes both rights", () => {
  const state = snapshotFromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const kingSideRook = state.position.pieces.find(({ square }) => square === "h1");
  const next = engine.applyAction(state, "white", { type: "move", move: { from: "e1", to: "g1" } });
  assert.equal(next.position.pieces.find(({ id }) => id === "white-king-1").square, "g1");
  assert.equal(next.position.pieces.find(({ id }) => id === kingSideRook.id).square, "f1");
  assert.deepEqual(next.position.castlingRights.white, { kingSide: false, queenSide: false });
});

test("en passant removes the pawn from its original square", () => {
  const state = snapshotFromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  const pawn = state.position.pieces.find(({ square }) => square === "e5");
  const next = engine.applyAction(state, "white", { type: "move", move: { from: "e5", to: "d6" } });
  assert.equal(next.position.pieces.some(({ square }) => square === "d5"), false);
  assert.equal(next.position.pieces.find(({ id }) => id === pawn.id).square, "d6");
  assert.equal(next.position.halfmoveClock, 0);
});

test("promotion changes the piece type while preserving its identity", () => {
  const state = snapshotFromFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  const pawn = state.position.pieces.find(({ square }) => square === "a7");
  const next = engine.applyAction(state, "white", {
    type: "move",
    move: { from: "a7", to: "a8", promotion: "knight" },
  });
  assert.deepEqual(next.position.pieces.find(({ id }) => id === pawn.id), {
    ...pawn,
    type: "knight",
    square: "a8",
  });
});

test("promotion requires a selected piece", () => {
  const state = snapshotFromFen("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  assert.throws(
    () => engine.applyAction(state, "white", { type: "move", move: { from: "a7", to: "a8" } }),
    /promotion piece/i,
  );
});

test("checkmate and stalemate finish the game with the correct result", () => {
  const mate = snapshotFromFen("7k/8/5KQ1/8/8/8/8/8 w - - 0 1", "mate");
  const afterMate = engine.applyAction(mate, "white", { type: "move", move: { from: "g6", to: "g7" } });
  assert.deepEqual(afterMate.phase, { kind: "finished", result: { kind: "win", winner: "white", reason: "checkmate" } });

  const stalemate = snapshotFromFen("7k/8/8/6Q1/5K2/8/8/8 w - - 0 1", "stalemate");
  const afterStalemate = engine.applyAction(stalemate, "white", { type: "move", move: { from: "g5", to: "g6" } });
  assert.deepEqual(afterStalemate.phase, { kind: "finished", result: { kind: "draw", reason: "stalemate" } });
});

test("move metadata advances en passant, clocks, turn and revision", () => {
  const state = engine.createInitialGame("metadata");
  const next = engine.applyAction(state, "white", { type: "move", move: { from: "e2", to: "e4" } });
  assert.equal(next.position.enPassantSquare, "e3");
  assert.equal(next.position.activeColor, "black");
  assert.equal(next.position.halfmoveClock, 0);
  assert.equal(next.position.fullmoveNumber, 1);
  assert.equal(next.revision, 1);
});

test("resignation ends the game for either player", () => {
  const state = engine.createInitialGame("resignation");
  const next = engine.applyAction(state, "black", { type: "resign" });
  assert.deepEqual(next.phase, { kind: "finished", result: { kind: "win", winner: "white", reason: "resignation" } });
});
