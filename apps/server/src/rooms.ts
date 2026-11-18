import { randomBytes, randomInt } from "node:crypto";
import type {
  ClientActionEnvelope,
  ClientGameCommand,
  Color,
  DieFace,
  EngineAction,
  GameEngine,
  GameSnapshot,
  LobbyChallengeSummary,
  LobbyCommand,
  LobbyGuestSummary,
  LobbyMessage,
  ServerMessage,
  SessionCommand,
} from "@remorse-chess/protocol";

interface Seat {
  readonly color: Color;
  readonly token: string;
  socketId?: string;
}

interface CachedAction {
  readonly message: ServerMessage;
}

interface RecentRoll {
  readonly player: Color;
  readonly captureId: string;
  readonly response: ServerMessage;
}

interface Room {
  readonly id: string;
  readonly inviteCode: string;
  readonly seats: { white: Seat; black?: Seat };
  readonly actions: Map<string, CachedAction>;
  state: GameSnapshot;
  queue: Promise<void>;
  recentRoll?: RecentRoll;
}

interface LobbyGuest {
  readonly id: string;
  readonly token: string;
  displayName: string;
  socketId?: string;
  lastSeenAt: number;
}

interface LobbyChallenge {
  readonly id: string;
  readonly fromGuestId: string;
  readonly toGuestId: string;
}

export interface RoomManagerOptions {
  readonly randomFace?: () => DieFace;
  readonly now?: () => number;
  readonly rateLimit?: {
    readonly maxCommands: number;
    readonly windowMs: number;
  };
}

export interface ActionSubmission {
  readonly message: ServerMessage;
  /** True only when this command accepted a new state and should be broadcast to the room. */
  readonly broadcast: boolean;
}

export interface LobbyDelivery {
  readonly socketId: string;
  readonly event: "message" | "lobby-message";
  readonly message: ServerMessage | LobbyMessage;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

const DEFAULT_RATE_LIMIT = { maxCommands: 80, windowMs: 10_000 } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionCommand(value: unknown): value is SessionCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "create-room":
      return true;
    case "join-room":
      return typeof value.inviteCode === "string" && value.inviteCode.length <= 64;
    case "rejoin-room":
      return typeof value.roomId === "string" && value.roomId.length <= 128
        && typeof value.seatToken === "string" && value.seatToken.length <= 128;
    case "request-snapshot":
      return typeof value.roomId === "string" && value.roomId.length <= 128;
    default:
      return false;
  }
}

function isLobbyCommand(value: unknown): value is LobbyCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "enter":
      return typeof value.displayName === "string" && value.displayName.length <= 64
        && (value.guestToken === undefined || (typeof value.guestToken === "string" && value.guestToken.length <= 128));
    case "leave":
      return typeof value.guestToken === "string" && value.guestToken.length <= 128;
    case "challenge":
      return typeof value.guestToken === "string" && value.guestToken.length <= 128
        && typeof value.targetGuestId === "string" && value.targetGuestId.length <= 128;
    case "respond":
      return typeof value.guestToken === "string" && value.guestToken.length <= 128
        && typeof value.challengeId === "string" && value.challengeId.length <= 128
        && typeof value.accept === "boolean";
    case "cancel":
      return typeof value.guestToken === "string" && value.guestToken.length <= 128
        && typeof value.challengeId === "string" && value.challengeId.length <= 128;
    default:
      return false;
  }
}

function cleanDisplayName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
}

function isActionEnvelope(value: unknown): value is ClientActionEnvelope {
  if (!isRecord(value) || typeof value.actionId !== "string" || value.actionId.length < 1
    || value.actionId.length > 128 || !Number.isSafeInteger(value.expectedRevision)
    || !isRecord(value.command) || typeof value.command.type !== "string") return false;
  const command = value.command;
  if (command.type === "move" || command.type === "bonus-move") {
    if (!isRecord(command.move)) return false;
    const move = command.move;
    return typeof move.from === "string" && typeof move.to === "string"
      && (move.promotion === undefined || ["queen", "rook", "bishop", "knight"].includes(String(move.promotion)));
  }
  return command.type === "request-roll" || command.type === "skip-bonus" || command.type === "resign";
}

function makeError(
  code: Extract<ServerMessage, { type: "error" }>['code'],
  message: string,
  actionId?: string,
): ServerMessage {
  return { type: "error", code, message, ...(actionId ? { actionId } : {}) };
}

function stateMessage(state: GameSnapshot): ServerMessage {
  return { type: "state", state: structuredClone(state) };
}

function makeToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function dieFace(): DieFace {
  return randomInt(1, 7) as DieFace;
}

function seatForSocket(room: Room, socketId: string): Seat | undefined {
  if (room.seats.white.socketId === socketId) return room.seats.white;
  if (room.seats.black?.socketId === socketId) return room.seats.black;
  return undefined;
}

/** In-memory room state and serialized authoritative action processing. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly invites = new Map<string, string>();
  private readonly lobbyGuests = new Map<string, LobbyGuest>();
  private readonly lobbyChallenges = new Map<string, LobbyChallenge>();
  private readonly rateWindows = new Map<string, RateWindow>();
  private readonly randomFace: () => DieFace;
  private readonly now: () => number;
  private readonly rateLimit: { readonly maxCommands: number; readonly windowMs: number };

  constructor(private readonly engine: GameEngine, options: RoomManagerOptions = {}) {
    this.randomFace = options.randomFace ?? dieFace;
    this.now = options.now ?? Date.now;
    this.rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  }

  handleSession(socketId: string, input: unknown): ServerMessage {
    if (!this.allowCommand(socketId)) {
      return makeError("invalid-command", "Too many commands. Please wait and try again.");
    }
    if (!isSessionCommand(input)) {
      return makeError("invalid-command", "The session command is invalid.");
    }

    switch (input.type) {
      case "create-room":
        if (this.roomForSocket(socketId)) {
          return makeError("invalid-command", "Leave the current room before creating another one.");
        }
        this.suspendLobbyGuest(socketId);
        return this.createRoom(socketId);
      case "join-room":
        {
          const message = this.joinRoom(socketId, input.inviteCode);
          if (message.type === "room-joined") this.suspendLobbyGuest(socketId);
          return message;
        }
      case "rejoin-room": {
        const message = this.rejoinRoom(socketId, input.roomId, input.seatToken);
        if (message.type === "room-joined") this.suspendLobbyGuest(socketId);
        return message;
      }
      case "request-snapshot": {
        const room = this.rooms.get(input.roomId);
        if (!room || !seatForSocket(room, socketId)) {
          return makeError("room-unavailable", "This invite is no longer active or this seat is not connected.");
        }
        return stateMessage(room.state);
      }
    }
  }

  handleLobbyCommand(socketId: string, input: unknown): LobbyDelivery[] {
    if (!this.allowCommand(socketId)) {
      return [this.lobbyError(socketId, "invalid-command", "Too many commands. Please wait and try again.")];
    }
    if (!isLobbyCommand(input)) {
      return [this.lobbyError(socketId, "invalid-command", "The lobby command is invalid.")];
    }
    this.pruneOfflineLobbyGuests();

    switch (input.type) {
      case "enter":
        return this.enterLobby(socketId, input.displayName, input.guestToken);
      case "leave":
        return this.leaveLobby(socketId, input.guestToken);
      case "challenge":
        return this.createChallenge(socketId, input.guestToken, input.targetGuestId);
      case "respond":
        return this.respondToChallenge(socketId, input.guestToken, input.challengeId, input.accept);
      case "cancel":
        return this.cancelChallenge(socketId, input.guestToken, input.challengeId);
    }
  }

  async submitAction(socketId: string, input: unknown): Promise<ActionSubmission> {
    if (!this.allowCommand(socketId)) {
      return { message: makeError("invalid-command", "Too many commands. Please wait and try again."), broadcast: false };
    }
    if (!isActionEnvelope(input)) {
      return { message: makeError("invalid-command", "The game action is invalid."), broadcast: false };
    }

    const room = [...this.rooms.values()].find((candidate) => seatForSocket(candidate, socketId));
    if (!room) {
      return { message: makeError("room-unavailable", "No active room is attached to this connection.", input.actionId), broadcast: false };
    }

    const operation = room.queue.then(() => this.applyEnvelope(room, socketId, input));
    room.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  getConnectedSocketIds(roomId: string): readonly string[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [room.seats.white.socketId, room.seats.black?.socketId]
      .filter((socketId): socketId is string => socketId !== undefined);
  }

  getLobbyStateDeliveries(): LobbyDelivery[] {
    const online = [...this.lobbyGuests.values()]
      .filter((guest) => guest.socketId !== undefined && !this.roomForSocket(guest.socketId))
      .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));

    return online.map((self) => {
      const summaries = [...this.lobbyChallenges.values()].flatMap((challenge) => {
        const from = this.lobbyGuests.get(challenge.fromGuestId);
        const to = this.lobbyGuests.get(challenge.toGuestId);
        if (!from || !to) return [];
        return [{
          challengeId: challenge.id,
          fromGuestId: from.id,
          fromName: from.displayName,
          toGuestId: to.id,
          toName: to.displayName,
        } satisfies LobbyChallengeSummary];
      });
      const message: LobbyMessage = {
        type: "lobby-state",
        self: { guestId: self.id, guestToken: self.token, displayName: self.displayName },
        online: online.filter((guest) => guest.id !== self.id)
          .map((guest): LobbyGuestSummary => ({ guestId: guest.id, displayName: guest.displayName })),
        incoming: summaries.filter((challenge) => challenge.toGuestId === self.id),
        outgoing: summaries.filter((challenge) => challenge.fromGuestId === self.id),
      };
      return { socketId: self.socketId!, event: "lobby-message", message };
    });
  }

  disconnect(socketId: string): LobbyDelivery[] {
    this.rateWindows.delete(socketId);
    this.suspendLobbyGuest(socketId);
    for (const [roomId, room] of this.rooms) {
      if (room.seats.white.socketId === socketId) delete room.seats.white.socketId;
      if (room.seats.black?.socketId === socketId) delete room.seats.black.socketId;
      if (!room.seats.white.socketId && !room.seats.black?.socketId) {
        this.rooms.delete(roomId);
        this.invites.delete(room.inviteCode);
      }
    }
    return this.getLobbyStateDeliveries();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  private enterLobby(socketId: string, rawName: string, token?: string): LobbyDelivery[] {
    if (this.roomForSocket(socketId)) {
      return [this.lobbyError(socketId, "room-unavailable", "Leave the private match before joining the lobby.")];
    }
    const current = this.lobbyGuestForSocket(socketId);
    const name = cleanDisplayName(rawName);
    if (!name) return [this.lobbyError(socketId, "invalid-command", "Enter a display name to join the lobby.")];
    if (current) {
      if (token !== current.token) {
        return [this.lobbyError(socketId, "guest-unavailable", "This connection is already using a different lobby identity.")];
      }
      current.displayName = name;
      current.lastSeenAt = this.now();
      return this.getLobbyStateDeliveries();
    }

    let guest: LobbyGuest | undefined;
    if (token) {
      guest = [...this.lobbyGuests.values()].find((candidate) => candidate.token === token);
      if (!guest) return [this.lobbyError(socketId, "guest-unavailable", "This lobby session expired. Join again to start a new guest session.")];
      if (guest.socketId && guest.socketId !== socketId) this.removeChallengesForGuest(guest.id);
    } else {
      let id: string;
      do id = makeToken(12); while (this.lobbyGuests.has(id));
      guest = { id, token: makeToken(), displayName: name, lastSeenAt: this.now() };
      this.lobbyGuests.set(id, guest);
    }

    guest.displayName = name;
    guest.socketId = socketId;
    guest.lastSeenAt = this.now();
    return this.getLobbyStateDeliveries();
  }

  private leaveLobby(socketId: string, token: string): LobbyDelivery[] {
    const guest = this.activeLobbyGuest(socketId, token);
    if (!guest) return [this.lobbyError(socketId, "not-in-lobby", "Join the lobby before leaving it.")];
    this.removeChallengesForGuest(guest.id);
    this.lobbyGuests.delete(guest.id);
    return [
      { socketId, event: "lobby-message", message: { type: "lobby-left" } },
      ...this.getLobbyStateDeliveries(),
    ];
  }

  private createChallenge(socketId: string, token: string, targetGuestId: string): LobbyDelivery[] {
    const from = this.activeLobbyGuest(socketId, token);
    if (!from) return [this.lobbyError(socketId, "not-in-lobby", "Join the lobby before challenging a guest.")];
    const to = this.lobbyGuests.get(targetGuestId);
    if (!to || !to.socketId || this.roomForSocket(to.socketId)) {
      return [this.lobbyError(socketId, "guest-unavailable", "That guest is no longer available.")];
    }
    if (from.id === to.id) {
      return [this.lobbyError(socketId, "invalid-command", "You cannot challenge yourself.")];
    }
    if (this.hasPendingChallenge(from.id) || this.hasPendingChallenge(to.id)) {
      return [this.lobbyError(socketId, "challenge-unavailable", "One of these guests already has a pending challenge.")];
    }

    let id: string;
    do id = makeToken(12); while (this.lobbyChallenges.has(id));
    this.lobbyChallenges.set(id, { id, fromGuestId: from.id, toGuestId: to.id });
    from.lastSeenAt = this.now();
    return this.getLobbyStateDeliveries();
  }

  private respondToChallenge(socketId: string, token: string, challengeId: string, accept: boolean): LobbyDelivery[] {
    const responder = this.activeLobbyGuest(socketId, token);
    const challenge = this.lobbyChallenges.get(challengeId);
    if (!responder || !challenge || challenge.toGuestId !== responder.id) {
      return [this.lobbyError(socketId, "challenge-unavailable", "That challenge is no longer available.")];
    }
    if (!accept) {
      this.lobbyChallenges.delete(challenge.id);
      return this.getLobbyStateDeliveries();
    }

    const challenger = this.lobbyGuests.get(challenge.fromGuestId);
    if (!challenger?.socketId || this.roomForSocket(challenger.socketId)
      || this.roomForSocket(responder.socketId!)) {
      this.lobbyChallenges.delete(challenge.id);
      return [
        this.lobbyError(socketId, "guest-unavailable", "The challenger is no longer available."),
        ...this.getLobbyStateDeliveries(),
      ];
    }

    const challengerSocketId = challenger.socketId;
    const responderSocketId = responder.socketId!;
    this.suspendLobbyGuest(challengerSocketId);
    this.suspendLobbyGuest(responderSocketId);
    const created = this.createRoom(challengerSocketId);
    if (created.type !== "room-created") {
      return [this.lobbyError(socketId, "room-unavailable", "The challenge could not start a match.")];
    }
    const joined = this.joinRoom(responderSocketId, created.inviteCode);
    if (joined.type !== "room-joined") {
      this.rooms.delete(created.roomId);
      this.invites.delete(created.inviteCode);
      return [this.lobbyError(socketId, "room-unavailable", "The challenge could not start a match.")];
    }

    return [
      ...this.getLobbyStateDeliveries(),
      { socketId: challengerSocketId, event: "message", message: created },
      { socketId: challengerSocketId, event: "message", message: stateMessage(joined.state) },
      { socketId: responderSocketId, event: "message", message: joined },
    ];
  }

  private cancelChallenge(socketId: string, token: string, challengeId: string): LobbyDelivery[] {
    const guest = this.activeLobbyGuest(socketId, token);
    const challenge = this.lobbyChallenges.get(challengeId);
    if (!guest || !challenge || challenge.fromGuestId !== guest.id) {
      return [this.lobbyError(socketId, "challenge-unavailable", "That outgoing challenge is no longer available.")];
    }
    this.lobbyChallenges.delete(challenge.id);
    return this.getLobbyStateDeliveries();
  }

  private lobbyError(
    socketId: string,
    code: Extract<LobbyMessage, { type: "lobby-error" }>['code'],
    message: string,
  ): LobbyDelivery {
    return { socketId, event: "lobby-message", message: { type: "lobby-error", code, message } };
  }

  private lobbyGuestForSocket(socketId: string): LobbyGuest | undefined {
    return [...this.lobbyGuests.values()].find((guest) => guest.socketId === socketId);
  }

  private activeLobbyGuest(socketId: string, token: string): LobbyGuest | undefined {
    const guest = this.lobbyGuestForSocket(socketId);
    if (!guest || guest.token !== token) return undefined;
    guest.lastSeenAt = this.now();
    return guest;
  }

  private suspendLobbyGuest(socketId: string): void {
    const guest = this.lobbyGuestForSocket(socketId);
    if (!guest) return;
    guest.socketId = undefined;
    guest.lastSeenAt = this.now();
    this.removeChallengesForGuest(guest.id);
  }

  private removeChallengesForGuest(guestId: string): void {
    for (const [id, challenge] of this.lobbyChallenges) {
      if (challenge.fromGuestId === guestId || challenge.toGuestId === guestId) {
        this.lobbyChallenges.delete(id);
      }
    }
  }

  private hasPendingChallenge(guestId: string): boolean {
    return [...this.lobbyChallenges.values()].some((challenge) =>
      challenge.fromGuestId === guestId || challenge.toGuestId === guestId);
  }

  private pruneOfflineLobbyGuests(): void {
    const cutoff = this.now() - 30 * 60 * 1000;
    for (const [id, guest] of this.lobbyGuests) {
      if (guest.socketId === undefined && guest.lastSeenAt < cutoff) {
        this.removeChallengesForGuest(id);
        this.lobbyGuests.delete(id);
      }
    }
  }

  private createRoom(socketId: string): ServerMessage {
    let id: string;
    do id = makeToken(18); while (this.rooms.has(id));
    let inviteCode: string;
    do inviteCode = makeToken(9); while (this.invites.has(inviteCode));
    const seat: Seat = { color: "white", token: makeToken(), socketId };
    const room: Room = {
      id,
      inviteCode,
      seats: { white: seat },
      actions: new Map(),
      state: this.engine.createInitialGame(id),
      queue: Promise.resolve(),
    };
    this.rooms.set(id, room);
    this.invites.set(inviteCode, id);
    return { type: "room-created", roomId: id, inviteCode, seatToken: seat.token, state: structuredClone(room.state) };
  }

  private joinRoom(socketId: string, inviteCode: string): ServerMessage {
    if (this.roomForSocket(socketId)) {
      return makeError("invalid-command", "Leave the current room before joining another one.");
    }
    const roomId = this.invites.get(inviteCode);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room || room.seats.black) {
      return makeError("room-unavailable", "This invite is invalid, expired, or already has two players.");
    }
    const seat: Seat = { color: "black", token: makeToken(), socketId };
    room.seats.black = seat;
    return { type: "room-joined", roomId: room.id, color: seat.color, seatToken: seat.token, state: structuredClone(room.state) };
  }

  private rejoinRoom(socketId: string, roomId: string, token: string): ServerMessage {
    const room = this.rooms.get(roomId);
    if (!room) return makeError("room-unavailable", "This invite is no longer active.");
    const existingRoom = this.roomForSocket(socketId);
    if (existingRoom && existingRoom !== room) {
      return makeError("invalid-command", "Leave the current room before rejoining another one.");
    }
    const seat = [room.seats.white, room.seats.black].find((candidate) => candidate?.token === token);
    const otherSeat = room.seats.white.socketId === socketId && room.seats.white !== seat
      || room.seats.black?.socketId === socketId && room.seats.black !== seat;
    if (!seat || otherSeat || (seat.socketId !== undefined && seat.socketId !== socketId)) {
      return makeError("room-unavailable", "This seat is unavailable or the seat credential is invalid.");
    }
    seat.socketId = socketId;
    return { type: "room-joined", roomId: room.id, color: seat.color, seatToken: seat.token, state: structuredClone(room.state) };
  }

  private async applyEnvelope(room: Room, socketId: string, envelope: ClientActionEnvelope): Promise<ActionSubmission> {
    const seat = seatForSocket(room, socketId);
    if (!seat) {
      return { message: makeError("room-unavailable", "This seat is no longer connected.", envelope.actionId), broadcast: false };
    }

    const cacheKey = `${seat.color}:${envelope.actionId}`;
    const cached = room.actions.get(cacheKey);
    if (cached) return { message: cached.message, broadcast: false };

    const fail = (message: ServerMessage): ActionSubmission => {
      room.actions.set(cacheKey, { message });
      return { message, broadcast: false };
    };

    if (!room.seats.black) {
      return fail(makeError("room-unavailable", "Waiting for the second player to join this invite.", envelope.actionId));
    }

    // A fresh action ID can still be a retry when a previous roll response was dropped.
    // Return the stored receipt without rolling again or broadcasting an old snapshot.
    if (envelope.command.type === "request-roll" && room.recentRoll?.player === seat.color
      && room.state.phase.kind !== "awaiting-roll") {
      const response = room.recentRoll.response;
      room.actions.set(cacheKey, { message: response });
      return { message: response, broadcast: false };
    }

    if (envelope.expectedRevision !== room.state.revision) {
      return fail(makeError("stale-revision", "The game changed. Use the latest snapshot before sending another action.", envelope.actionId));
    }

    if (envelope.command.type !== "resign" && !this.isPlayersAction(room.state, seat.color)) {
      return fail(makeError("not-your-turn", "This seat cannot act during the current turn phase.", envelope.actionId));
    }

    let engineAction: EngineAction;
    const command: ClientGameCommand = envelope.command;
    if (command.type === "request-roll") {
      if (room.state.phase.kind !== "awaiting-roll" || room.state.phase.player !== seat.color) {
        return fail(makeError("invalid-command", "A roll is not pending for this seat.", envelope.actionId));
      }
      engineAction = {
        type: "resolve-roll" as const,
        captureId: room.state.phase.capture.id,
        face: this.randomFace(),
      };
    } else {
      engineAction = command;
    }

    try {
      const previous = room.state;
      const next = this.engine.applyAction(previous, seat.color, engineAction);
      if (next.revision <= previous.revision) {
        throw new Error("The rules engine did not advance the game revision.");
      }
      room.state = next;
      room.recentRoll = undefined;
      const message = stateMessage(next);
      room.actions.set(cacheKey, { message });
      if (command.type === "request-roll" && previous.phase.kind === "awaiting-roll") {
        room.recentRoll = { player: seat.color, captureId: previous.phase.capture.id, response: message };
      }
      return { message, broadcast: true };
    } catch (error) {
      const description = error instanceof Error ? error.message : "The rules engine rejected the action.";
      const code = /turn/i.test(description) ? "not-your-turn" : "invalid-command";
      return fail(makeError(code, description, envelope.actionId));
    }
  }

  private isPlayersAction(state: GameSnapshot, color: Color): boolean {
    switch (state.phase.kind) {
      case "active":
        return state.position.activeColor === color;
      case "awaiting-roll":
      case "awaiting-bonus":
        return state.phase.player === color;
      case "finished":
        return false;
    }
  }

  private roomForSocket(socketId: string): Room | undefined {
    return [...this.rooms.values()].find((room) => seatForSocket(room, socketId));
  }

  private allowCommand(socketId: string): boolean {
    const now = this.now();
    const window = this.rateWindows.get(socketId);
    if (!window || now - window.startedAt >= this.rateLimit.windowMs) {
      this.rateWindows.set(socketId, { startedAt: now, count: 1 });
      return true;
    }
    if (window.count >= this.rateLimit.maxCommands) return false;
    window.count += 1;
    return true;
  }
}
