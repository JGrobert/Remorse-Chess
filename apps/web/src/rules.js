const FILES = "abcdefgh";
const STEPS = {
  knight: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  king: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
  rook: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  bishop: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
};
const PIECE_TYPES = ["king", "queen", "rook", "bishop", "knight", "pawn"];

export function toIndex(square) {
  return (Number(square[1]) - 1) * 8 + FILES.indexOf(square[0]);
}

export function toSquare(index) {
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}`;
}

function onBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function indexOf(file, rank) {
  return rank * 8 + file;
}

function boardFrom(snapshot) {
  return new Map(snapshot.position.pieces.map((piece) => [toIndex(piece.square), piece]));
}

function opposite(color) {
  return color === "white" ? "black" : "white";
}

function rayMoves(board, from, piece, directions) {
  const moves = [];
  const startFile = from % 8;
  const startRank = Math.floor(from / 8);
  for (const [df, dr] of directions) {
    let file = startFile + df;
    let rank = startRank + dr;
    while (onBoard(file, rank)) {
      const to = indexOf(file, rank);
      const target = board.get(to);
      if (!target) moves.push(to);
      else {
        if (target.color !== piece.color && target.type !== "king") moves.push(to);
        break;
      }
      file += df;
      rank += dr;
    }
  }
  return moves;
}

function pseudoMoves(snapshot, board, from, piece, { attacksOnly = false } = {}) {
  const file = from % 8;
  const rank = Math.floor(from / 8);
  if (piece.type === "pawn") {
    const direction = piece.color === "white" ? 1 : -1;
    const steps = [];
    for (const captureFile of [file - 1, file + 1]) {
      const captureRank = rank + direction;
      if (!onBoard(captureFile, captureRank)) continue;
      const target = indexOf(captureFile, captureRank);
      const occupant = board.get(target);
      if (attacksOnly || (occupant && occupant.color !== piece.color && occupant.type !== "king")) steps.push(target);
      else if (snapshot.position.enPassantSquare === toSquare(target)) {
        const captured = board.get(indexOf(captureFile, rank));
        if (captured?.type === "pawn" && captured.color !== piece.color) steps.push(target);
      }
    }
    if (!attacksOnly) {
      const nextRank = rank + direction;
      if (onBoard(file, nextRank) && !board.has(indexOf(file, nextRank))) {
        steps.push(indexOf(file, nextRank));
        const startRank = piece.color === "white" ? 1 : 6;
        const doubleRank = rank + direction * 2;
        if (rank === startRank && !board.has(indexOf(file, doubleRank))) steps.push(indexOf(file, doubleRank));
      }
    }
    return steps;
  }
  if (piece.type === "knight" || piece.type === "king") {
    const moves = [];
    for (const [df, dr] of STEPS[piece.type]) {
      const targetFile = file + df;
      const targetRank = rank + dr;
      if (!onBoard(targetFile, targetRank)) continue;
      const target = indexOf(targetFile, targetRank);
      const occupant = board.get(target);
      if (!occupant || (occupant.color !== piece.color && occupant.type !== "king")) moves.push(target);
    }
    return moves;
  }
  if (piece.type === "rook") return rayMoves(board, from, piece, STEPS.rook);
  if (piece.type === "bishop") return rayMoves(board, from, piece, STEPS.bishop);
  return rayMoves(board, from, piece, [...STEPS.rook, ...STEPS.bishop]);
}

function attacked(board, target, byColor) {
  for (const [from, piece] of board) {
    if (piece.color !== byColor || piece.status?.kind === "guilty") continue;
    const file = from % 8;
    const rank = Math.floor(from / 8);
    const targetFile = target % 8;
    const targetRank = Math.floor(target / 8);
    const df = targetFile - file;
    const dr = targetRank - rank;
    if (piece.type === "pawn" && Math.abs(df) === 1 && dr === (byColor === "white" ? 1 : -1)) return true;
    if (piece.type === "knight" && ((Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1))) return true;
    if (piece.type === "king" && Math.max(Math.abs(df), Math.abs(dr)) === 1) return true;
    const diagonal = Math.abs(df) === Math.abs(dr) && df !== 0;
    const straight = (df === 0) !== (dr === 0);
    if ((piece.type === "bishop" && diagonal) || (piece.type === "rook" && straight)
      || (piece.type === "queen" && (diagonal || straight))) {
      const stepFile = Math.sign(df);
      const stepRank = Math.sign(dr);
      let walkFile = file + stepFile;
      let walkRank = rank + stepRank;
      let clear = true;
      while (walkFile !== targetFile || walkRank !== targetRank) {
        if (board.has(indexOf(walkFile, walkRank))) {
          clear = false;
          break;
        }
        walkFile += stepFile;
        walkRank += stepRank;
      }
      if (clear) return true;
    }
  }
  return false;
}

function applyMove(board, from, to, piece, snapshot) {
  const next = new Map(board);
  next.delete(from);
  if (piece.type === "pawn" && snapshot.position.enPassantSquare === toSquare(to) && !board.has(to) && from % 8 !== to % 8) {
    next.delete(Math.floor(from / 8) * 8 + (to % 8));
  }
  next.delete(to);
  let moved = { ...piece, square: toSquare(to) };
  if (piece.type === "pawn" && Math.floor(to / 8) === (piece.color === "white" ? 7 : 0)) moved = { ...moved, type: "queen" };
  next.set(to, moved);
  if (piece.type === "king" && Math.abs(to - from) === 2) {
    const rank = piece.color === "white" ? 0 : 7;
    const kingSide = to > from;
    const rookFrom = rank * 8 + (kingSide ? 7 : 0);
    const rookTo = rank * 8 + (kingSide ? 5 : 3);
    const rook = next.get(rookFrom);
    if (rook) {
      next.delete(rookFrom);
      next.set(rookTo, { ...rook, square: toSquare(rookTo) });
    }
  }
  return next;
}

function findKing(board, color) {
  for (const [square, piece] of board) if (piece.color === color && piece.type === "king") return square;
  return -1;
}

function castleMoves(snapshot, board, from, piece) {
  if (piece.type !== "king") return [];
  const homeRank = piece.color === "white" ? 0 : 7;
  if (from !== homeRank * 8 + 4 || attacked(board, from, opposite(piece.color))) return [];
  const rights = snapshot.position.castlingRights[piece.color];
  const result = [];
  for (const side of ["kingSide", "queenSide"]) {
    if (!rights[side]) continue;
    const rookFile = side === "kingSide" ? 7 : 0;
    const rook = board.get(homeRank * 8 + rookFile);
    if (rook?.type !== "rook" || rook.color !== piece.color) continue;
    const gap = side === "kingSide" ? [5, 6] : [1, 2, 3];
    if (gap.some((file) => board.has(homeRank * 8 + file))) continue;
    const transit = homeRank * 8 + (side === "kingSide" ? 5 : 3);
    const transitBoard = new Map(board);
    transitBoard.delete(from);
    transitBoard.set(transit, { ...piece, square: toSquare(transit) });
    if (attacked(transitBoard, transit, opposite(piece.color))) continue;
    result.push(homeRank * 8 + (side === "kingSide" ? 6 : 2));
  }
  return result;
}

export function getLegalDestinations(snapshot, pieceId) {
  const piece = snapshot.position.pieces.find((item) => item.id === pieceId);
  if (!piece) return [];
  const board = boardFrom(snapshot);
  const from = toIndex(piece.square);
  const destinations = [...pseudoMoves(snapshot, board, from, piece), ...castleMoves(snapshot, board, from, piece)];
  const king = findKing(board, piece.color);
  return destinations.filter((to) => {
    const target = board.get(to);
    const isEnPassantCapture = piece.type === "pawn" && snapshot.position.enPassantSquare === toSquare(to);
    if (piece.status?.kind === "guilty" && ((target && target.color !== piece.color) || isEnPassantCapture)) return false;
    const next = applyMove(board, from, to, piece, snapshot);
    const kingAfter = piece.type === "king" ? to : findKing(next, piece.color);
    return kingAfter >= 0 && !attacked(next, kingAfter, opposite(piece.color));
  }).map(toSquare);
}

export function getCaptureDestinations(snapshot, pieceId) {
  const piece = snapshot.position.pieces.find((item) => item.id === pieceId);
  if (!piece) return [];
  const board = boardFrom(snapshot);
  return getLegalDestinations(snapshot, pieceId).filter((square) => {
    const to = toIndex(square);
    const target = board.get(to);
    return (target && target.color !== piece.color) || (piece.type === "pawn" && snapshot.position.enPassantSquare === square);
  });
}

export function getDisplaySquares(bottomColor = "white") {
  const squares = [];
  const ranks = bottomColor === "white" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = bottomColor === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  for (const rank of ranks) for (const file of files) squares.push(`${FILES[file]}${rank + 1}`);
  return squares;
}

export function pieceGlyph(piece) {
  const symbols = {
    white: { king: "♔", queen: "♕", rook: "♖", bishop: "♗", knight: "♘", pawn: "♙" },
    black: { king: "♚", queen: "♛", rook: "♜", bishop: "♝", knight: "♞", pawn: "♟" },
  };
  return symbols[piece.color][piece.type] ?? "?";
}

export function pieceName(type) {
  return PIECE_TYPES.includes(type) ? type : "piece";
}
