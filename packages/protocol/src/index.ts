export type Color = "white" | "black";

export type File = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type Square = `${File}${Rank}`;

export type PieceType = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";

export type ModifierKind = "devastated" | "guilty" | "psycho";

export interface PieceStatus {
  readonly kind: ModifierKind;
  readonly remainingTurns: number;
}

export interface ChessPiece {
  readonly id: string;
  readonly color: Color;
  readonly type: PieceType;
  readonly square: Square;
  readonly status?: PieceStatus;
}

export interface CastlingRights {
  readonly kingSide: boolean;
  readonly queenSide: boolean;
}

export interface BoardPosition {
  readonly pieces: readonly ChessPiece[];
  readonly activeColor: Color;
  readonly castlingRights: Readonly<Record<Color, CastlingRights>>;
  readonly enPassantSquare: Square | null;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
}

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

export type RollEffect = ModifierKind | "none";

export interface RollResult {
  readonly face: DieFace;
  readonly effect: RollEffect;
  readonly pieceId: string;
}

export interface CaptureRecord {
  readonly id: string;
  readonly capturingPieceId: string;
  readonly capturedPieceId: string;
  readonly from: Square;
  readonly to: Square;
}

export type GameResult =
  | {
      readonly kind: "win";
      readonly winner: Color;
      readonly reason: "checkmate" | "king-exposed" | "resignation";
    }
  | {
      readonly kind: "draw";
      readonly reason: "stalemate" | "bare-kings" | "agreement";
    };

export type GamePhase =
  | {
      readonly kind: "active";
    }
  | {
      readonly kind: "awaiting-roll";
      readonly player: Color;
      readonly capture: CaptureRecord;
    }
  | {
      readonly kind: "awaiting-bonus";
      readonly player: Color;
      readonly capture: CaptureRecord;
      readonly roll: RollResult;
    }
  | {
      readonly kind: "finished";
      readonly result: GameResult;
    };

export interface GameSnapshot {
  readonly matchId: string;
  readonly revision: number;
  readonly position: BoardPosition;
  readonly phase: GamePhase;
  readonly lastRoll: RollResult | null;
}

export interface MoveInput {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: "queen" | "rook" | "bishop" | "knight";
}

export type ClientGameCommand =
  | {
      readonly type: "move";
      readonly move: MoveInput;
    }
  | {
      readonly type: "bonus-move";
      readonly move: MoveInput;
    }
  | {
      readonly type: "request-roll";
    }
  | {
      readonly type: "skip-bonus";
    }
  | {
      readonly type: "resign";
    };

export interface ClientActionEnvelope {
  readonly actionId: string;
  readonly expectedRevision: number;
  readonly command: ClientGameCommand;
}

export type EngineAction =
  | {
      readonly type: "move";
      readonly move: MoveInput;
    }
  | {
      readonly type: "bonus-move";
      readonly move: MoveInput;
    }
  | {
      readonly type: "resolve-roll";
      readonly captureId: string;
      readonly face: DieFace;
    }
  | {
      readonly type: "skip-bonus";
    }
  | {
      readonly type: "resign";
    };

export interface GameEngine {
  createInitialGame(matchId: string): GameSnapshot;
  getLegalMoves(state: GameSnapshot, pieceId: string): readonly Square[];
  applyAction(state: GameSnapshot, actor: Color, action: EngineAction): GameSnapshot;
}

export type SessionCommand =
  | {
      readonly type: "create-room";
    }
  | {
      readonly type: "join-room";
      readonly inviteCode: string;
    }
  | {
      readonly type: "rejoin-room";
      readonly roomId: string;
      readonly seatToken: string;
    }
  | {
      readonly type: "request-snapshot";
      readonly roomId: string;
    };

export type ServerMessage =
  | {
      readonly type: "room-created";
      readonly roomId: string;
      readonly inviteCode: string;
      readonly seatToken: string;
      readonly state: GameSnapshot;
    }
  | {
      readonly type: "room-joined";
      readonly roomId: string;
      readonly color: Color;
      readonly seatToken: string;
      readonly state: GameSnapshot;
    }
  | {
      readonly type: "state";
      readonly state: GameSnapshot;
    }
  | {
      readonly type: "room-closed";
      readonly reason: "both-players-left";
    }
  | {
      readonly type: "error";
      readonly code: "invalid-command" | "stale-revision" | "not-your-turn" | "room-unavailable";
      readonly message: string;
      readonly actionId?: string;
    };

export interface LobbyGuestSummary {
  readonly guestId: string;
  readonly displayName: string;
}

export interface LobbyChallengeSummary {
  readonly challengeId: string;
  readonly fromGuestId: string;
  readonly fromName: string;
  readonly toGuestId: string;
  readonly toName: string;
}

export interface LobbyGuestIdentity extends LobbyGuestSummary {
  readonly guestToken: string;
}

export type LobbyCommand =
  | {
      readonly type: "enter";
      readonly displayName: string;
      readonly guestToken?: string;
    }
  | {
      readonly type: "leave";
      readonly guestToken: string;
    }
  | {
      readonly type: "challenge";
      readonly guestToken: string;
      readonly targetGuestId: string;
    }
  | {
      readonly type: "respond";
      readonly guestToken: string;
      readonly challengeId: string;
      readonly accept: boolean;
    }
  | {
      readonly type: "cancel";
      readonly guestToken: string;
      readonly challengeId: string;
    };

export type LobbyMessage =
  | {
      readonly type: "lobby-state";
      readonly self: LobbyGuestIdentity;
      readonly online: readonly LobbyGuestSummary[];
      readonly incoming: readonly LobbyChallengeSummary[];
      readonly outgoing: readonly LobbyChallengeSummary[];
    }
  | {
      readonly type: "lobby-left";
    }
  | {
      readonly type: "lobby-error";
      readonly code: "invalid-command" | "not-in-lobby" | "guest-unavailable" | "challenge-unavailable" | "room-unavailable";
      readonly message: string;
    };
