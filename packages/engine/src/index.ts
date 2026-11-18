import type {
  BoardPosition,
  CastlingRights,
  ChessPiece,
  Color,
  EngineAction,
  GameEngine,
  GameSnapshot,
  MoveInput,
  PieceType,
  Square,
} from "@remorse-chess/protocol";

type Board = (ChessPiece | undefined)[];

interface CandidateMove {
  readonly to: number;
  readonly capturedAt?: number;
  readonly enPassant?: boolean;
  readonly castle?: "kingSide" | "queenSide";
}

const FILES = "abcdefgh";
const STARTING_PIECES: readonly [Color, PieceType, number, number][] = [
  ["white", "rook", 0, 0],
  ["white", "knight", 1, 0],
  ["white", "bishop", 2, 0],
  ["white", "queen", 3, 0],
  ["white", "king", 4, 0],
  ["white", "bishop", 5, 0],
  ["white", "knight", 6, 0],
  ["white", "rook", 7, 0],
  ["black", "rook", 0, 7],
  ["black", "knight", 1, 7],
  ["black", "bishop", 2, 7],
  ["black", "queen", 3, 7],
  ["black", "king", 4, 7],
  ["black", "bishop", 5, 7],
  ["black", "knight", 6, 7],
  ["black", "rook", 7, 7],
];

const INITIAL_PAWN_RANKS: readonly [Color, number][] = [
  ["white", 1],
  ["black", 6],
];

const KNIGHT_STEPS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
] as const;

const KING_STEPS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

const ROOK_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRECTIONS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const PROMOTION_TYPES: readonly PieceType[] = ["queen", "rook", "bishop", "knight"];

function opposite(color: Color): Color {
  return color === "white" ? "black" : "white";
}

function toIndex(square: Square): number {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  if (file === -1 || !Number.isInteger(rank) || rank < 1 || rank > 8) return -1;
  return (rank - 1) * 8 + file;
}

function toSquare(index: number): Square {
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}` as Square;
}

function fileOf(index: number): number {
  return index % 8;
}

function rankOf(index: number): number {
  return Math.floor(index / 8);
}

function isOnBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function createBoard(pieces: readonly ChessPiece[]): Board {
  const board: Board = Array.from({ length: 64 });
  for (const piece of pieces) {
    const index = toIndex(piece.square);
    if (index < 0 || index >= 64 || board[index]) {
      throw new Error(`Invalid position: more than one piece occupies ${piece.square}`);
    }
    board[index] = piece;
  }
  return board;
}

function findKing(board: Board, color: Color): number {
  const index = board.findIndex((piece) => piece?.color === color && piece.type === "king");
  if (index === -1) {
    throw new Error(`Invalid position: ${color} has no king`);
  }
  return index;
}

function isRayAttack(
  board: Board,
  from: number,
  target: number,
  directions: readonly (readonly [number, number])[],
): boolean {
  const startFile = fileOf(from);
  const startRank = rankOf(from);
  for (const [df, dr] of directions) {
    let file = startFile + df;
    let rank = startRank + dr;
    while (isOnBoard(file, rank)) {
      const index = rank * 8 + file;
      if (index === target) return true;
      if (board[index]) break;
      file += df;
      rank += dr;
    }
  }
  return false;
}

function isSquareAttacked(board: Board, target: number, byColor: Color): boolean {
  const targetFile = fileOf(target);
  const targetRank = rankOf(target);

  for (let from = 0; from < board.length; from += 1) {
    const piece = board[from];
    if (!piece || piece.color !== byColor) continue;

    const fromFile = fileOf(from);
    const fromRank = rankOf(from);
    const df = targetFile - fromFile;
    const dr = targetRank - fromRank;

    switch (piece.type) {
      case "pawn":
        if (Math.abs(df) === 1 && dr === (byColor === "white" ? 1 : -1)) return true;
        break;
      case "knight":
        if ((Math.abs(df) === 1 && Math.abs(dr) === 2)
          || (Math.abs(df) === 2 && Math.abs(dr) === 1)) return true;
        break;
      case "king":
        if (Math.max(Math.abs(df), Math.abs(dr)) === 1) return true;
        break;
      case "rook":
        if (isRayAttack(board, from, target, ROOK_DIRECTIONS)) return true;
        break;
      case "bishop":
        if (isRayAttack(board, from, target, BISHOP_DIRECTIONS)) return true;
        break;
      case "queen":
        if (isRayAttack(board, from, target, [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS])) return true;
        break;
    }
  }
  return false;
}

function addStepMoves(
  board: Board,
  from: number,
  piece: ChessPiece,
  steps: readonly (readonly [number, number])[],
  moves: CandidateMove[],
): void {
  const startFile = fileOf(from);
  const startRank = rankOf(from);
  for (const [df, dr] of steps) {
    const file = startFile + df;
    const rank = startRank + dr;
    if (!isOnBoard(file, rank)) continue;
    const to = rank * 8 + file;
    const occupant = board[to];
    if (!occupant) moves.push({ to });
    else if (occupant.color !== piece.color && occupant.type !== "king") {
      moves.push({ to, capturedAt: to });
    }
  }
}

function addSlidingMoves(
  board: Board,
  from: number,
  piece: ChessPiece,
  directions: readonly (readonly [number, number])[],
  moves: CandidateMove[],
): void {
  const startFile = fileOf(from);
  const startRank = rankOf(from);
  for (const [df, dr] of directions) {
    let file = startFile + df;
    let rank = startRank + dr;
    while (isOnBoard(file, rank)) {
      const to = rank * 8 + file;
      const occupant = board[to];
      if (!occupant) moves.push({ to });
      else {
        if (occupant.color !== piece.color && occupant.type !== "king") {
          moves.push({ to, capturedAt: to });
        }
        break;
      }
      file += df;
      rank += dr;
    }
  }
}

function addPawnMoves(
  board: Board,
  position: BoardPosition,
  from: number,
  piece: ChessPiece,
  moves: CandidateMove[],
): void {
  const direction = piece.color === "white" ? 1 : -1;
  const startRank = piece.color === "white" ? 1 : 6;
  const file = fileOf(from);
  const rank = rankOf(from);
  const nextRank = rank + direction;
  if (isOnBoard(file, nextRank)) {
    const forward = nextRank * 8 + file;
    if (!board[forward]) {
      moves.push({ to: forward });
      const doubleRank = rank + direction * 2;
      const doubleForward = doubleRank * 8 + file;
      if (rank === startRank && !board[doubleForward]) moves.push({ to: doubleForward });
    }

    for (const captureFile of [file - 1, file + 1]) {
      if (!isOnBoard(captureFile, nextRank)) continue;
      const to = nextRank * 8 + captureFile;
      const occupant = board[to];
      if (occupant && occupant.color !== piece.color && occupant.type !== "king") {
        moves.push({ to, capturedAt: to });
      } else if (position.enPassantSquare === toSquare(to)) {
        const capturedAt = rank * 8 + captureFile;
        const captured = board[capturedAt];
        if (captured?.type === "pawn" && captured.color !== piece.color) {
          moves.push({ to, capturedAt, enPassant: true });
        }
      }
    }
  }
}

function canCastle(
  board: Board,
  position: BoardPosition,
  piece: ChessPiece,
  from: number,
  side: "kingSide" | "queenSide",
): CandidateMove | undefined {
  const homeRank = piece.color === "white" ? 0 : 7;
  const homeKing = homeRank * 8 + 4;
  if (piece.type !== "king" || from !== homeKing) return undefined;
  if (!position.castlingRights[piece.color][side]) return undefined;

  const rookFile = side === "kingSide" ? 7 : 0;
  const rookIndex = homeRank * 8 + rookFile;
  const rook = board[rookIndex];
  if (rook?.type !== "rook" || rook.color !== piece.color) return undefined;

  const emptyFiles = side === "kingSide" ? [5, 6] : [1, 2, 3];
  if (emptyFiles.some((file) => board[homeRank * 8 + file])) return undefined;
  const transitFile = side === "kingSide" ? 5 : 3;
  const destinationFile = side === "kingSide" ? 6 : 2;
  const enemy = opposite(piece.color);
  if (isSquareAttacked(board, from, enemy)) return undefined;

  const transitBoard = board.slice();
  transitBoard[from] = undefined;
  transitBoard[homeRank * 8 + transitFile] = { ...piece, square: toSquare(homeRank * 8 + transitFile) };
  if (isSquareAttacked(transitBoard, homeRank * 8 + transitFile, enemy)) return undefined;

  return { to: homeRank * 8 + destinationFile, castle: side };
}

function getPseudoMoves(
  board: Board,
  position: BoardPosition,
  from: number,
  piece: ChessPiece,
): CandidateMove[] {
  const moves: CandidateMove[] = [];
  switch (piece.type) {
    case "pawn":
      addPawnMoves(board, position, from, piece, moves);
      break;
    case "knight":
      addStepMoves(board, from, piece, KNIGHT_STEPS, moves);
      break;
    case "bishop":
      addSlidingMoves(board, from, piece, BISHOP_DIRECTIONS, moves);
      break;
    case "rook":
      addSlidingMoves(board, from, piece, ROOK_DIRECTIONS, moves);
      break;
    case "queen":
      addSlidingMoves(board, from, piece, [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS], moves);
      break;
    case "king":
      addStepMoves(board, from, piece, KING_STEPS, moves);
      for (const side of ["kingSide", "queenSide"] as const) {
        const castle = canCastle(board, position, piece, from, side);
        if (castle) moves.push(castle);
      }
      break;
  }
  return moves;
}

function applyCandidate(
  board: Board,
  piece: ChessPiece,
  from: number,
  candidate: CandidateMove,
  promotion?: PieceType,
): Board {
  const next = board.slice();
  next[from] = undefined;
  if (candidate.capturedAt !== undefined) next[candidate.capturedAt] = undefined;

  const movedPiece: ChessPiece = {
    ...piece,
    square: toSquare(candidate.to),
    ...(promotion ? { type: promotion } : {}),
  };
  next[candidate.to] = movedPiece;

  if (candidate.castle) {
    const homeRank = piece.color === "white" ? 0 : 7;
    const rookFrom = homeRank * 8 + (candidate.castle === "kingSide" ? 7 : 0);
    const rookTo = homeRank * 8 + (candidate.castle === "kingSide" ? 5 : 3);
    const rook = next[rookFrom];
    if (!rook) throw new Error("Invalid castling move: rook is missing");
    next[rookFrom] = undefined;
    next[rookTo] = { ...rook, square: toSquare(rookTo) };
  }
  return next;
}

function getLegalCandidates(
  board: Board,
  position: BoardPosition,
  from: number,
  piece: ChessPiece,
): CandidateMove[] {
  const kingIndex = piece.type === "king" ? undefined : findKing(board, piece.color);
  return getPseudoMoves(board, position, from, piece).filter((candidate) => {
    const after = applyCandidate(board, piece, from, candidate);
    const ownKing = kingIndex === undefined ? candidate.to : findKing(after, piece.color);
    return !isSquareAttacked(after, ownKing, opposite(piece.color));
  });
}

function getLegalCandidatesForColor(board: Board, position: BoardPosition, color: Color): CandidateMove[] {
  const all: CandidateMove[] = [];
  for (let from = 0; from < board.length; from += 1) {
    const piece = board[from];
    if (piece?.color === color) {
      all.push(...getLegalCandidates(board, position, from, piece));
    }
  }
  return all;
}

function isPromotionMove(piece: ChessPiece, to: number): boolean {
  return piece.type === "pawn" && (rankOf(to) === 0 || rankOf(to) === 7);
}

function updateCastlingRights(
  rights: Readonly<Record<Color, CastlingRights>>,
  movingPiece: ChessPiece,
  from: Square,
  capturedPiece: ChessPiece | undefined,
  captureSquare: Square | undefined,
): Readonly<Record<Color, CastlingRights>> {
  const next: Record<Color, CastlingRights> = {
    white: { ...rights.white },
    black: { ...rights.black },
  };

  const revokeRookRight = (color: Color, square: Square) => {
    const homeRank = color === "white" ? "1" : "8";
    if (square === `a${homeRank}`) next[color] = { ...next[color], queenSide: false };
    if (square === `h${homeRank}`) next[color] = { ...next[color], kingSide: false };
  };

  if (movingPiece.type === "king") {
    next[movingPiece.color] = { kingSide: false, queenSide: false };
  } else if (movingPiece.type === "rook") {
    revokeRookRight(movingPiece.color, from);
  }
  if (capturedPiece?.type === "rook" && captureSquare) {
    revokeRookRight(capturedPiece.color, captureSquare);
  }
  return next;
}

function findMoveCandidate(
  state: GameSnapshot,
  move: MoveInput,
  board: Board,
  piece: ChessPiece,
): CandidateMove {
  const from = toIndex(move.from);
  const to = toIndex(move.to);
  const candidate = getLegalCandidates(board, state.position, from, piece).find((item) => item.to === to);
  if (!candidate) throw new Error(`Illegal move: ${move.from}-${move.to}`);

  const promotionRequired = isPromotionMove(piece, to);
  if (promotionRequired && !move.promotion) {
    throw new Error("A promotion piece must be selected");
  }
  if (move.promotion && (!promotionRequired || !PROMOTION_TYPES.includes(move.promotion))) {
    throw new Error("Invalid promotion piece");
  }
  return candidate;
}

function applyMove(state: GameSnapshot, actor: Color, move: MoveInput): GameSnapshot {
  const position = state.position;
  if (actor !== position.activeColor) throw new Error("It is not this player's turn");

  const board = createBoard(position.pieces);
  const from = toIndex(move.from);
  const piece = board[from];
  if (!piece || piece.color !== actor) throw new Error("No movable piece occupies the source square");
  const candidate = findMoveCandidate(state, move, board, piece);
  const capturedPiece = candidate.capturedAt === undefined ? undefined : board[candidate.capturedAt];
  const captureSquare = candidate.capturedAt === undefined ? undefined : toSquare(candidate.capturedAt);
  const nextBoard = applyCandidate(board, piece, from, candidate, move.promotion);
  const nextActiveColor = opposite(actor);
  const isPawnMove = piece.type === "pawn";
  const isCapture = capturedPiece !== undefined;
  const nextPosition: BoardPosition = {
    pieces: nextBoard.filter((item): item is ChessPiece => item !== undefined),
    activeColor: nextActiveColor,
    castlingRights: updateCastlingRights(position.castlingRights, piece, move.from, capturedPiece, captureSquare),
    enPassantSquare: isPawnMove && Math.abs(rankOf(candidate.to) - rankOf(from)) === 2
      ? toSquare((candidate.to + from) / 2)
      : null,
    halfmoveClock: isPawnMove || isCapture ? 0 : position.halfmoveClock + 1,
    fullmoveNumber: position.fullmoveNumber + (actor === "black" ? 1 : 0),
  };

  let next: GameSnapshot = {
    ...state,
    revision: state.revision + 1,
    position: nextPosition,
    phase: { kind: "active" },
  };

  const nextBoardForCheck = createBoard(nextPosition.pieces);
  const opponentMoves = getLegalCandidatesForColor(nextBoardForCheck, nextPosition, nextActiveColor);
  if (opponentMoves.length === 0) {
    const inCheck = isSquareAttacked(
      nextBoardForCheck,
      findKing(nextBoardForCheck, nextActiveColor),
      actor,
    );
    next = {
      ...next,
      phase: inCheck
        ? { kind: "finished", result: { kind: "win", winner: actor, reason: "checkmate" } }
        : { kind: "finished", result: { kind: "draw", reason: "stalemate" } },
    };
  }
  return next;
}

function initialPieces(): ChessPiece[] {
  const pieces: ChessPiece[] = [];
  const typeCounts = new Map<string, number>();
  for (const [color, type, file, rank] of STARTING_PIECES) {
    const key = `${color}-${type}`;
    const duplicateIndex = typeCounts.get(key) ?? 0;
    typeCounts.set(key, duplicateIndex + 1);
    pieces.push({
      id: `${key}-${duplicateIndex + 1}`,
      color,
      type,
      square: toSquare(rank * 8 + file),
    });
  }
  for (const [color, rank] of INITIAL_PAWN_RANKS) {
    for (let file = 0; file < 8; file += 1) {
      pieces.push({ id: `${color}-pawn-${FILES[file]}`, color, type: "pawn", square: toSquare(rank * 8 + file) });
    }
  }
  return pieces;
}

export class StandardChessEngine implements GameEngine {
  createInitialGame(matchId: string): GameSnapshot {
    return {
      matchId,
      revision: 0,
      position: {
        pieces: initialPieces(),
        activeColor: "white",
        castlingRights: {
          white: { kingSide: true, queenSide: true },
          black: { kingSide: true, queenSide: true },
        },
        enPassantSquare: null,
        halfmoveClock: 0,
        fullmoveNumber: 1,
      },
      phase: { kind: "active" },
      lastRoll: null,
    };
  }

  getLegalMoves(state: GameSnapshot, pieceId: string): readonly Square[] {
    if (state.phase.kind !== "active") return [];
    const piece = state.position.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece || piece.color !== state.position.activeColor) return [];
    const board = createBoard(state.position.pieces);
    const from = toIndex(piece.square);
    return getLegalCandidates(board, state.position, from, piece).map(({ to }) => toSquare(to));
  }

  applyAction(state: GameSnapshot, actor: Color, action: EngineAction): GameSnapshot {
    if (state.phase.kind !== "active") throw new Error("The game is not accepting standard moves");
    switch (action.type) {
      case "move":
        return applyMove(state, actor, action.move);
      case "resign":
        return {
          ...state,
          revision: state.revision + 1,
          phase: { kind: "finished", result: { kind: "win", winner: opposite(actor), reason: "resignation" } },
        };
      case "bonus-move":
      case "resolve-roll":
      case "skip-bonus":
        throw new Error(`Action ${action.type} is outside the standard chess rules engine`);
    }
  }
}

export const standardChessEngine: GameEngine = new StandardChessEngine();

export { RemorseChessEngine } from "./remorse.js";
