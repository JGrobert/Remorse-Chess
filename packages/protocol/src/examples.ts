import type { GameSnapshot } from "./index.js";

const castlingRights = {
  white: { kingSide: false, queenSide: false },
  black: { kingSide: false, queenSide: false },
} as const;

export const activeAfterMove = {
  matchId: "example-active",
  revision: 7,
  position: {
    pieces: [
      { id: "white-king", color: "white", type: "king", square: "e1" },
      { id: "black-king", color: "black", type: "king", square: "e8" },
      { id: "white-pawn-e", color: "white", type: "pawn", square: "e4" },
      { id: "black-pawn-d", color: "black", type: "pawn", square: "d5" },
    ],
    activeColor: "black",
    castlingRights,
    enPassantSquare: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  },
  phase: { kind: "active" },
  lastRoll: null,
} satisfies GameSnapshot;

export const awaitingRoll = {
  matchId: "example-roll",
  revision: 3,
  position: {
    pieces: [
      { id: "white-king", color: "white", type: "king", square: "e1" },
      { id: "black-king", color: "black", type: "king", square: "e8" },
      { id: "white-queen", color: "white", type: "queen", square: "e5" },
      { id: "black-rook", color: "black", type: "rook", square: "a8" },
    ],
    activeColor: "white",
    castlingRights,
    enPassantSquare: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  },
  phase: {
    kind: "awaiting-roll",
    player: "white",
    capture: {
      id: "capture-1",
      capturingPieceId: "white-queen",
      capturedPieceId: "black-pawn-e",
      from: "e4",
      to: "e5",
    },
  },
  lastRoll: null,
} satisfies GameSnapshot;

export const awaitingPsychoBonus = {
  matchId: "example-bonus",
  revision: 5,
  position: {
    pieces: [
      { id: "white-king", color: "white", type: "king", square: "e1" },
      { id: "black-king", color: "black", type: "king", square: "a8" },
      {
        id: "white-queen",
        color: "white",
        type: "queen",
        square: "e5",
        status: { kind: "psycho", remainingTurns: 2 },
      },
      { id: "black-rook-f", color: "black", type: "rook", square: "f5" },
    ],
    activeColor: "white",
    castlingRights,
    enPassantSquare: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  },
  phase: {
    kind: "awaiting-bonus",
    player: "white",
    capture: {
      id: "capture-2",
      capturingPieceId: "white-queen",
      capturedPieceId: "black-pawn-e",
      from: "e4",
      to: "e5",
    },
    roll: { face: 4, effect: "none", pieceId: "white-queen" },
  },
  lastRoll: { face: 4, effect: "none", pieceId: "white-queen" },
} satisfies GameSnapshot;

export const finishedByResignation = {
  matchId: "example-finished",
  revision: 12,
  position: {
    pieces: [
      { id: "white-king", color: "white", type: "king", square: "e1" },
      { id: "black-king", color: "black", type: "king", square: "e8" },
    ],
    activeColor: "black",
    castlingRights,
    enPassantSquare: null,
    halfmoveClock: 0,
    fullmoveNumber: 6,
  },
  phase: {
    kind: "finished",
    result: { kind: "win", winner: "white", reason: "resignation" },
  },
  lastRoll: null,
} satisfies GameSnapshot;
