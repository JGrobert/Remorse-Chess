import type {
  BoardPosition,
  CastlingRights,
  ChessPiece,
  Color,
  DieFace,
  EngineAction,
  GameEngine,
  GameSnapshot,
  MoveInput,
  PieceStatus,
  PieceType,
  RollEffect,
  RollResult,
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
  ["white", "rook", 0, 0], ["white", "knight", 1, 0], ["white", "bishop", 2, 0],
  ["white", "queen", 3, 0], ["white", "king", 4, 0], ["white", "bishop", 5, 0],
  ["white", "knight", 6, 0], ["white", "rook", 7, 0],
  ["black", "rook", 0, 7], ["black", "knight", 1, 7], ["black", "bishop", 2, 7],
  ["black", "queen", 3, 7], ["black", "king", 4, 7], ["black", "bishop", 5, 7],
  ["black", "knight", 6, 7], ["black", "rook", 7, 7],
];
const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ROOK_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const BISHOP_DIRECTIONS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const PROMOTION_TYPES: readonly PieceType[] = ["queen", "rook", "bishop", "knight"];

function opposite(color: Color): Color { return color === "white" ? "black" : "white"; }
function toIndex(square: Square): number {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  if (file === -1 || !Number.isInteger(rank) || rank < 1 || rank > 8) return -1;
  return (rank - 1) * 8 + file;
}
function toSquare(index: number): Square { return `${FILES[index % 8]}${Math.floor(index / 8) + 1}` as Square; }
function fileOf(index: number): number { return index % 8; }
function rankOf(index: number): number { return Math.floor(index / 8); }
function onBoard(file: number, rank: number): boolean { return file >= 0 && file < 8 && rank >= 0 && rank < 8; }

function createBoard(pieces: readonly ChessPiece[]): Board {
  const board: Board = Array.from({ length: 64 });
  for (const piece of pieces) {
    const index = toIndex(piece.square);
    if (index < 0 || board[index]) throw new Error(`Invalid position: more than one piece occupies ${piece.square}`);
    board[index] = piece;
  }
  return board;
}
function findKing(board: Board, color: Color): number {
  const index = board.findIndex((piece) => piece?.color === color && piece.type === "king");
  if (index < 0) throw new Error(`Invalid position: ${color} has no king`);
  return index;
}
function rayAttacks(board: Board, from: number, target: number, directions: readonly (readonly [number, number])[]): boolean {
  for (const [df, dr] of directions) {
    let file = fileOf(from) + df;
    let rank = rankOf(from) + dr;
    while (onBoard(file, rank)) {
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
    if (!piece || piece.color !== byColor || piece.status?.kind === "guilty") continue;
    const df = targetFile - fileOf(from);
    const dr = targetRank - rankOf(from);
    switch (piece.type) {
      case "pawn": if (Math.abs(df) === 1 && dr === (byColor === "white" ? 1 : -1)) return true; break;
      case "knight": if ((Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1)) return true; break;
      case "king": if (Math.max(Math.abs(df), Math.abs(dr)) === 1) return true; break;
      case "rook": if (rayAttacks(board, from, target, ROOK_DIRECTIONS)) return true; break;
      case "bishop": if (rayAttacks(board, from, target, BISHOP_DIRECTIONS)) return true; break;
      case "queen": if (rayAttacks(board, from, target, [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS])) return true; break;
    }
  }
  return false;
}
function addStepMoves(board: Board, from: number, piece: ChessPiece, steps: readonly (readonly [number, number])[], moves: CandidateMove[]): void {
  for (const [df, dr] of steps) {
    const file = fileOf(from) + df;
    const rank = rankOf(from) + dr;
    if (!onBoard(file, rank)) continue;
    const to = rank * 8 + file;
    const occupant = board[to];
    if (!occupant) moves.push({ to });
    else if (occupant.color !== piece.color && occupant.type !== "king" && piece.status?.kind !== "guilty") moves.push({ to, capturedAt: to });
  }
}
function addSlidingMoves(board: Board, from: number, piece: ChessPiece, directions: readonly (readonly [number, number])[], moves: CandidateMove[]): void {
  for (const [df, dr] of directions) {
    let file = fileOf(from) + df;
    let rank = rankOf(from) + dr;
    while (onBoard(file, rank)) {
      const to = rank * 8 + file;
      const occupant = board[to];
      if (!occupant) moves.push({ to });
      else {
        if (occupant.color !== piece.color && occupant.type !== "king" && piece.status?.kind !== "guilty") moves.push({ to, capturedAt: to });
        break; // Guilty sliders are still blocked by occupied squares.
      }
      file += df;
      rank += dr;
    }
  }
}
function addPawnMoves(board: Board, position: BoardPosition, from: number, piece: ChessPiece, moves: CandidateMove[]): void {
  const direction = piece.color === "white" ? 1 : -1;
  const startRank = piece.color === "white" ? 1 : 6;
  const file = fileOf(from);
  const rank = rankOf(from);
  const nextRank = rank + direction;
  if (!onBoard(file, nextRank)) return;
  const forward = nextRank * 8 + file;
  if (!board[forward]) {
    moves.push({ to: forward });
    const doubleRank = rank + direction * 2;
    if (rank === startRank && !board[doubleRank * 8 + file]) moves.push({ to: doubleRank * 8 + file });
  }
  for (const captureFile of [file - 1, file + 1]) {
    if (!onBoard(captureFile, nextRank) || piece.status?.kind === "guilty") continue;
    const to = nextRank * 8 + captureFile;
    const occupant = board[to];
    if (occupant && occupant.color !== piece.color && occupant.type !== "king") moves.push({ to, capturedAt: to });
    else if (position.enPassantSquare === toSquare(to)) {
      const capturedAt = rank * 8 + captureFile;
      const captured = board[capturedAt];
      if (captured?.type === "pawn" && captured.color !== piece.color) moves.push({ to, capturedAt, enPassant: true });
    }
  }
}
function canCastle(board: Board, position: BoardPosition, piece: ChessPiece, from: number, side: "kingSide" | "queenSide"): CandidateMove | undefined {
  const homeRank = piece.color === "white" ? 0 : 7;
  const homeKing = homeRank * 8 + 4;
  if (piece.type !== "king" || from !== homeKing || !position.castlingRights[piece.color][side]) return undefined;
  const rookIndex = homeRank * 8 + (side === "kingSide" ? 7 : 0);
  const rook = board[rookIndex];
  if (rook?.type !== "rook" || rook.color !== piece.color) return undefined;
  const emptyFiles = side === "kingSide" ? [5, 6] : [1, 2, 3];
  if (emptyFiles.some((file) => board[homeRank * 8 + file])) return undefined;
  const transitFile = side === "kingSide" ? 5 : 3;
  const enemy = opposite(piece.color);
  if (isSquareAttacked(board, from, enemy)) return undefined;
  const transitBoard = board.slice();
  transitBoard[from] = undefined;
  transitBoard[homeRank * 8 + transitFile] = { ...piece, square: toSquare(homeRank * 8 + transitFile) };
  if (isSquareAttacked(transitBoard, homeRank * 8 + transitFile, enemy)) return undefined;
  return { to: homeRank * 8 + (side === "kingSide" ? 6 : 2), castle: side };
}
function pseudoMoves(board: Board, position: BoardPosition, from: number, piece: ChessPiece): CandidateMove[] {
  const moves: CandidateMove[] = [];
  switch (piece.type) {
    case "pawn": addPawnMoves(board, position, from, piece, moves); break;
    case "knight": addStepMoves(board, from, piece, KNIGHT_STEPS, moves); break;
    case "bishop": addSlidingMoves(board, from, piece, BISHOP_DIRECTIONS, moves); break;
    case "rook": addSlidingMoves(board, from, piece, ROOK_DIRECTIONS, moves); break;
    case "queen": addSlidingMoves(board, from, piece, [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS], moves); break;
    case "king":
      addStepMoves(board, from, piece, KING_STEPS, moves);
      for (const side of ["kingSide", "queenSide"] as const) {
        const candidate = canCastle(board, position, piece, from, side);
        if (candidate) moves.push(candidate);
      }
      break;
  }
  return moves;
}
function applyCandidate(board: Board, piece: ChessPiece, from: number, candidate: CandidateMove, promotion?: PieceType): Board {
  const next = board.slice();
  next[from] = undefined;
  if (candidate.capturedAt !== undefined) next[candidate.capturedAt] = undefined;
  next[candidate.to] = { ...piece, square: toSquare(candidate.to), ...(promotion ? { type: promotion } : {}) };
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
function legalCandidates(board: Board, position: BoardPosition, from: number, piece: ChessPiece): CandidateMove[] {
  const kingIndex = piece.type === "king" ? undefined : findKing(board, piece.color);
  return pseudoMoves(board, position, from, piece).filter((candidate) => {
    const after = applyCandidate(board, piece, from, candidate);
    const ownKing = kingIndex === undefined ? candidate.to : findKing(after, piece.color);
    return !isSquareAttacked(after, ownKing, opposite(piece.color));
  });
}
function legalCandidatesForColor(board: Board, position: BoardPosition, color: Color): CandidateMove[] {
  const all: CandidateMove[] = [];
  for (let from = 0; from < board.length; from += 1) {
    const piece = board[from];
    if (piece?.color === color) all.push(...legalCandidates(board, position, from, piece));
  }
  return all;
}
function isPromotion(piece: ChessPiece, to: number): boolean { return piece.type === "pawn" && (rankOf(to) === 0 || rankOf(to) === 7); }
function updateCastlingRights(
  rights: Readonly<Record<Color, CastlingRights>>,
  movingPiece: ChessPiece,
  from: Square,
  capturedPiece: ChessPiece | undefined,
  captureSquare: Square | undefined,
): Readonly<Record<Color, CastlingRights>> {
  const next: Record<Color, CastlingRights> = { white: { ...rights.white }, black: { ...rights.black } };
  const revoke = (color: Color, square: Square) => {
    const home = color === "white" ? "1" : "8";
    if (square === `a${home}`) next[color] = { ...next[color], queenSide: false };
    if (square === `h${home}`) next[color] = { ...next[color], kingSide: false };
  };
  if (movingPiece.type === "king") next[movingPiece.color] = { kingSide: false, queenSide: false };
  else if (movingPiece.type === "rook") revoke(movingPiece.color, from);
  if (capturedPiece?.type === "rook" && captureSquare) revoke(capturedPiece.color, captureSquare);
  return next;
}
function findCandidate(state: GameSnapshot, move: MoveInput, board: Board, piece: ChessPiece): CandidateMove {
  const from = toIndex(move.from);
  const to = toIndex(move.to);
  const candidate = legalCandidates(board, state.position, from, piece).find((item) => item.to === to);
  if (!candidate) throw new Error(`Illegal move: ${move.from}-${move.to}`);
  const promotionRequired = isPromotion(piece, to);
  if (promotionRequired && !move.promotion) throw new Error("A promotion piece must be selected");
  if (move.promotion && (!promotionRequired || !PROMOTION_TYPES.includes(move.promotion))) throw new Error("Invalid promotion piece");
  return candidate;
}
function isBishopLanding(board: Board, from: number, piece: ChessPiece): boolean {
  return piece.type === "bishop" && board[from] === undefined;
}
function rescueAdjacent(pieces: readonly ChessPiece[], landing: Square, color: Color): ChessPiece[] {
  const center = toIndex(landing);
  return pieces.map((piece) => {
    if (piece.color !== color || piece.type === "bishop" || (piece.status?.kind !== "devastated" && piece.status?.kind !== "guilty")) return piece;
    const index = toIndex(piece.square);
    if (Math.max(Math.abs(fileOf(index) - fileOf(center)), Math.abs(rankOf(index) - rankOf(center))) !== 1) return piece;
    const { status: _status, ...rescued } = piece;
    return rescued;
  });
}
function rollResult(face: DieFace, piece: ChessPiece): RollResult {
  let effect: RollEffect;
  if (piece.type === "king") effect = face === 6 ? "psycho" : "none";
  else if (face === 1) effect = "devastated";
  else if (face === 2 || face === 3) effect = "guilty";
  else if (face === 6) effect = "psycho";
  else effect = "none";
  return { face, effect, pieceId: piece.id };
}
function statusFor(effect: RollEffect): PieceStatus | undefined {
  return effect === "none" ? undefined : { kind: effect, remainingTurns: 3 };
}
function setPieceStatus(pieces: readonly ChessPiece[], id: string, status: PieceStatus): ChessPiece[] {
  return pieces.map((piece) => piece.id === id ? { ...piece, status } : piece);
}
function applyRollAndExpire(pieces: readonly ChessPiece[], roll: RollResult | undefined, movedPieceIds: readonly string[]): ChessPiece[] {
  let next = [...pieces];
  const newStatus = roll ? statusFor(roll.effect) : undefined;
  if (roll && newStatus) next = setPieceStatus(next, roll.pieceId, newStatus);
  const freshId = newStatus ? roll?.pieceId : undefined;
  const moveCounts = new Map<string, number>();
  for (const id of movedPieceIds) moveCounts.set(id, (moveCounts.get(id) ?? 0) + 1);
  const settled: ChessPiece[] = [];
  for (const piece of next) {
    const status = piece.status;
    const movesMade = moveCounts.get(piece.id) ?? 0;
    if (!status || piece.id === freshId || movesMade === 0) {
      settled.push(piece);
    } else if (status.remainingTurns > movesMade) {
      settled.push({ ...piece, status: { ...status, remainingTurns: status.remainingTurns - movesMade } });
    } else if (status.kind !== "devastated") {
      const { status: _status, ...rescued } = piece;
      settled.push(rescued);
    }
  }
  return settled;
}
function revokeRightsForRemovedRook(position: BoardPosition, removed: readonly ChessPiece[]): Readonly<Record<Color, CastlingRights>> {
  const rights: Record<Color, CastlingRights> = { white: { ...position.castlingRights.white }, black: { ...position.castlingRights.black } };
  for (const piece of removed) {
    if (piece.type !== "rook") continue;
    const home = piece.color === "white" ? "1" : "8";
    if (piece.square === `a${home}`) rights[piece.color] = { ...rights[piece.color], queenSide: false };
    if (piece.square === `h${home}`) rights[piece.color] = { ...rights[piece.color], kingSide: false };
  }
  return rights;
}
function isBareKings(pieces: readonly ChessPiece[]): boolean { return pieces.length === 2 && pieces.every((piece) => piece.type === "king"); }
function finishTurn(state: GameSnapshot, actor: Color, roll: RollResult | undefined, movedPieceIds: readonly string[]): GameSnapshot {
  let pieces = applyRollAndExpire(state.position.pieces, roll, movedPieceIds);
  const removed = state.position.pieces.filter((piece) => !pieces.some((next) => next.id === piece.id));
  const rights = revokeRightsForRemovedRook(state.position, removed);
  const position: BoardPosition = {
    ...state.position,
    pieces,
    activeColor: opposite(actor),
    castlingRights: rights,
    fullmoveNumber: state.position.fullmoveNumber + (actor === "black" ? 1 : 0),
  };
  const board = createBoard(pieces);
  const actorKing = findKing(board, actor);
  if (isSquareAttacked(board, actorKing, opposite(actor))) {
    return { ...state, position, phase: { kind: "finished", result: { kind: "win", winner: opposite(actor), reason: "king-exposed" } } };
  }
  if (isBareKings(pieces)) return { ...state, position, phase: { kind: "finished", result: { kind: "draw", reason: "bare-kings" } } };
  const enemy = opposite(actor);
  const moves = legalCandidatesForColor(board, position, enemy);
  if (moves.length === 0) {
    const check = isSquareAttacked(board, findKing(board, enemy), actor);
    return {
      ...state,
      position,
      phase: check
        ? { kind: "finished", result: { kind: "win", winner: actor, reason: "checkmate" } }
        : { kind: "finished", result: { kind: "draw", reason: "stalemate" } },
    };
  }
  return { ...state, position, phase: { kind: "active" } };
}
function createCaptureId(state: GameSnapshot): string { return `${state.matchId}-capture-${state.revision + 1}`; }
function movePiece(state: GameSnapshot, actor: Color, move: MoveInput): {
  readonly next: GameSnapshot;
  readonly movingPiece: ChessPiece;
  readonly movedPieceIds: readonly string[];
  readonly capturedPiece?: ChessPiece;
  readonly candidate: CandidateMove;
} {
  const position = state.position;
  const board = createBoard(position.pieces);
  const from = toIndex(move.from);
  const piece = board[from];
  if (!piece || piece.color !== actor) throw new Error("No movable piece occupies the source square");
  const candidate = findCandidate(state, move, board, piece);
  const capturedPiece = candidate.capturedAt === undefined ? undefined : board[candidate.capturedAt];
  const captureSquare = candidate.capturedAt === undefined ? undefined : toSquare(candidate.capturedAt);
  let movedBoard = applyCandidate(board, piece, from, candidate, move.promotion);
  const movedPieceIds = [piece.id];
  if (candidate.castle) {
    const homeRank = piece.color === "white" ? 0 : 7;
    const rookFrom = homeRank * 8 + (candidate.castle === "kingSide" ? 7 : 0);
    const rook = board[rookFrom];
    if (rook) movedPieceIds.push(rook.id);
  }
  let pieces = movedBoard.filter((item): item is ChessPiece => item !== undefined);
  const didBishopLand = isBishopLanding(movedBoard, from, piece);
  if (didBishopLand) pieces = rescueAdjacent(pieces, toSquare(candidate.to), actor);
  const pawnMove = piece.type === "pawn";
  const capture = capturedPiece !== undefined;
  const nextPosition: BoardPosition = {
    pieces,
    activeColor: position.activeColor,
    castlingRights: updateCastlingRights(position.castlingRights, piece, move.from, capturedPiece, captureSquare),
    enPassantSquare: pawnMove && Math.abs(rankOf(candidate.to) - rankOf(from)) === 2 ? toSquare((candidate.to + from) / 2) : null,
    halfmoveClock: pawnMove || capture ? 0 : position.halfmoveClock + 1,
    fullmoveNumber: position.fullmoveNumber,
  };
  movedBoard = createBoard(pieces);
  const next: GameSnapshot = { ...state, revision: state.revision + 1, position: nextPosition, phase: { kind: "active" } };
  return { next, movingPiece: piece, movedPieceIds, ...(capturedPiece ? { capturedPiece } : {}), candidate };
}
function ensureActor(actor: Color, expected: Color): void {
  if (actor !== expected) throw new Error("It is not this player's turn");
}
function resolveFirstMove(state: GameSnapshot, actor: Color, move: MoveInput): GameSnapshot {
  ensureActor(actor, state.position.activeColor);
  const { next, movingPiece, movedPieceIds, capturedPiece, candidate } = movePiece(state, actor, move);
  if (!capturedPiece) return finishTurn(next, actor, undefined, movedPieceIds);
  const capture = {
    id: createCaptureId(state),
    capturingPieceId: movingPiece.id,
    capturedPieceId: capturedPiece.id,
    from: move.from,
    to: toSquare(candidate.to),
  };
  return {
    ...next,
    phase: { kind: "awaiting-roll", player: actor, capture },
  };
}
function settleRoll(state: GameSnapshot, actor: Color, roll: RollResult, movedPieceIds: readonly string[]): GameSnapshot {
  const next = { ...state, lastRoll: roll };
  return finishTurn(next, actor, roll, movedPieceIds);
}
function resolveRoll(state: GameSnapshot, actor: Color, captureId: string, face: DieFace): GameSnapshot {
  if (![1, 2, 3, 4, 5, 6].includes(face)) throw new Error("A die face must be between one and six");
  const phase = state.phase;
  if (phase.kind !== "awaiting-roll") throw new Error("The game is not waiting for a roll");
  ensureActor(actor, phase.player);
  if (phase.capture.id !== captureId) throw new Error("Roll does not match the pending capture");
  const piece = state.position.pieces.find(({ id }) => id === phase.capture.capturingPieceId);
  if (!piece) throw new Error("The capturing piece is no longer on the board");
  const roll = rollResult(face, piece);
  const board = createBoard(state.position.pieces);
  const from = toIndex(piece.square);
  const canBonus = (piece.status?.kind === "psycho" || roll.effect === "psycho")
    && legalCandidates(board, state.position, from, piece).some(({ capturedAt }) => capturedAt !== undefined);
  const withRoll = { ...state, revision: state.revision + 1, lastRoll: roll };
  if (canBonus) return { ...withRoll, phase: { kind: "awaiting-bonus", player: actor, capture: phase.capture, roll } };
  return settleRoll(withRoll, actor, roll, [phase.capture.capturingPieceId]);
}
function resolveBonus(state: GameSnapshot, actor: Color, move: MoveInput): GameSnapshot {
  const phase = state.phase;
  if (phase.kind !== "awaiting-bonus") throw new Error("The game is not waiting for a bonus capture");
  ensureActor(actor, phase.player);
  const piece = state.position.pieces.find(({ id }) => id === phase.capture.capturingPieceId);
  if (!piece) throw new Error("The capturing piece is no longer on the board");
  if (move.from !== piece.square) throw new Error("A Psycho bonus must use the same capturing piece");
  const { next, movingPiece, capturedPiece } = movePiece(state, actor, move);
  if (!capturedPiece) throw new Error("A Psycho bonus move must capture");
  // Apply the first roll only after this optional capture, so it cannot cancel the earned bonus.
  // The bonus capture never opens another roll.
  return settleRoll(next, actor, phase.roll, [phase.capture.capturingPieceId, movingPiece.id]);
}
function initialPieces(): ChessPiece[] {
  const pieces: ChessPiece[] = [];
  const counts = new Map<string, number>();
  for (const [color, type, file, rank] of STARTING_PIECES) {
    const key = `${color}-${type}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    pieces.push({ id: `${key}-${index + 1}`, color, type, square: toSquare(rank * 8 + file) });
  }
  for (const [color, rank] of [["white", 1], ["black", 6]] as const) {
    for (let file = 0; file < 8; file += 1) pieces.push({ id: `${color}-pawn-${FILES[file]}`, color, type: "pawn", square: toSquare(rank * 8 + file) });
  }
  return pieces;
}

/** Deterministic chess engine with the Remorse modifier and turn-resolution rules. */
export class RemorseChessEngine implements GameEngine {
  createInitialGame(matchId: string): GameSnapshot {
    return {
      matchId, revision: 0,
      position: {
        pieces: initialPieces(), activeColor: "white",
        castlingRights: { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } },
        enPassantSquare: null, halfmoveClock: 0, fullmoveNumber: 1,
      },
      phase: { kind: "active" }, lastRoll: null,
    };
  }

  getLegalMoves(state: GameSnapshot, pieceId: string): readonly Square[] {
    const phase = state.phase;
    if (phase.kind === "awaiting-roll" || phase.kind === "finished") return [];
    const piece = state.position.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece || piece.color !== state.position.activeColor) return [];
    if (phase.kind === "awaiting-bonus" && piece.id !== phase.capture.capturingPieceId) return [];
    const board = createBoard(state.position.pieces);
    const moves = legalCandidates(board, state.position, toIndex(piece.square), piece);
    return moves.filter(({ capturedAt }) => phase.kind !== "awaiting-bonus" || capturedAt !== undefined).map(({ to }) => toSquare(to));
  }

  applyAction(state: GameSnapshot, actor: Color, action: EngineAction): GameSnapshot {
    if (state.phase.kind === "finished") throw new Error("The game is finished");
    if (action.type === "resign") {
      return { ...state, revision: state.revision + 1, phase: { kind: "finished", result: { kind: "win", winner: opposite(actor), reason: "resignation" } } };
    }
    if (action.type === "resolve-roll") return resolveRoll(state, actor, action.captureId, action.face);
    if (action.type === "skip-bonus") {
      if (state.phase.kind !== "awaiting-bonus") throw new Error("There is no Psycho bonus to skip");
      ensureActor(actor, state.phase.player);
      return settleRoll({ ...state, revision: state.revision + 1 }, actor, state.phase.roll, [state.phase.capture.capturingPieceId]);
    }
    if (action.type === "bonus-move") return resolveBonus(state, actor, action.move);
    if (action.type === "move") {
      if (state.phase.kind !== "active") throw new Error("The game is resolving a capture");
      return resolveFirstMove(state, actor, action.move);
    }
    throw new Error("Unsupported game action");
  }
}
