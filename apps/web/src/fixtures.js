const noRights = {
  white: { kingSide: false, queenSide: false },
  black: { kingSide: false, queenSide: false },
};

export const previewSnapshot = {
  matchId: "preview-match",
  revision: 0,
  position: {
    pieces: [
      { id: "white-king", color: "white", type: "king", square: "e1" },
      { id: "black-king", color: "black", type: "king", square: "e8" },
      { id: "white-queen", color: "white", type: "queen", square: "e4", status: { kind: "psycho", remainingTurns: 2 } },
      { id: "white-knight", color: "white", type: "knight", square: "b3", status: { kind: "devastated", remainingTurns: 1 } },
      { id: "black-pawn", color: "black", type: "pawn", square: "c6", status: { kind: "guilty", remainingTurns: 3 } },
      { id: "black-rook", color: "black", type: "rook", square: "g5" },
      { id: "white-pawn", color: "white", type: "pawn", square: "a2" },
      { id: "black-pawn-e", color: "black", type: "pawn", square: "e7" },
    ],
    activeColor: "white",
    castlingRights: noRights,
    enPassantSquare: null,
    halfmoveClock: 4,
    fullmoveNumber: 8,
  },
  phase: { kind: "active" },
  lastRoll: { face: 6, effect: "psycho", pieceId: "white-queen" },
};
