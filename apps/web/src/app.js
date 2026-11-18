import { previewSnapshot } from "./fixtures.js";
import { getDieControlState } from "./die-controls.js";
import { getCaptureDestinations, getDisplaySquares, getLegalDestinations } from "./rules.js";
import { initializeBoardCamera, orientBoardForPlayer } from "./board-scene.js";
import { createDieAnimator } from "./dice-scene.js";

const glyphStatus = {
  devastated: { mark: "✕", label: "Devastated", effect: "will be removed when its turns run out" },
  guilty: { mark: "!", label: "Guilty", effect: "cannot capture" },
  psycho: { mark: "⚡", label: "Psycho", effect: "may take one bonus capture" },
};
const squareNames = { a: "A", b: "B", c: "C", d: "D", e: "E", f: "F", g: "G", h: "H" };
const elements = {
  connection: document.querySelector("#connection-status"),
  board: document.querySelector("#board"),
  ranks: document.querySelector("#rank-labels"),
  files: document.querySelector("#file-labels"),
  turnLabel: document.querySelector("#turn-label"),
  turnIndicator: document.querySelector("#turn-indicator"),
  caption: document.querySelector("#board-caption"),
  activity: document.querySelector("#activity-message"),
  revision: document.querySelector("#revision-label"),
  dieFace: document.querySelector("#die-face"),
  dieCopy: document.querySelector("#die-copy"),
  dieNote: document.querySelector("#die-note"),
  dieCube: document.querySelector("#die-cube"),
  roll: document.querySelector("#roll-die"),
  rollLabel: document.querySelector("#die-roll-label"),
  skip: document.querySelector("#skip-bonus"),
  lobby: document.querySelector("#lobby-controls"),
  room: document.querySelector("#room-controls"),
  roomTitle: document.querySelector("#room-title"),
  roomMessage: document.querySelector("#room-message"),
  seat: document.querySelector("#seat-label"),
  inviteShare: document.querySelector("#invite-share"),
  inviteLink: document.querySelector("#invite-link"),
  create: document.querySelector("#create-room"),
  rejoin: document.querySelector("#rejoin-room"),
  joinForm: document.querySelector("#join-form"),
  inviteCode: document.querySelector("#invite-code"),
  copyInvite: document.querySelector("#copy-invite"),
  lobbyEntry: document.querySelector("#guest-lobby-entry"),
  lobbyName: document.querySelector("#lobby-display-name"),
  lobbyJoin: document.querySelector("#lobby-join"),
  lobbyStatus: document.querySelector("#lobby-status"),
  lobbyDirectory: document.querySelector("#lobby-directory"),
  lobbyOnline: document.querySelector("#lobby-online"),
  lobbyChallenges: document.querySelector("#lobby-challenges"),
  lobbyLeave: document.querySelector("#lobby-leave"),
  leave: document.querySelector("#leave-room"),
  resign: document.querySelector("#resign"),
  orientation: document.querySelector("#orientation"),
  themeToggle: document.querySelector("#theme-toggle"),
  promotion: document.querySelector("#promotion-dialog"),
  toast: document.querySelector("#toast"),
};

let snapshot = previewSnapshot;
let demoMode = true;
let socket;
let connected = false;
let seatColor = null;
let roomId = null;
let inviteCode = null;
let opponentJoined = false;
let selectedSquare = null;
let legalSquares = [];
let pendingPromotion = null;
let pendingAction = null;
let pendingActionKey = null;
const actionIds = new Map();
let pendingJoin = false;
let autoSessionSent = false;
let pendingSessionCommand = null;
let pendingLobbyCommand = null;
let lobbySelf = null;
let lobbyOnline = [];
let lobbyIncoming = [];
let lobbyOutgoing = [];
let demoMessage = "Create an invite or join a private match to begin.";
let bottomColor = "white";
let toastTimer;
let rollAnimationStartedAt = 0;
let rollLandingTimer = 0;
const dieAnimator = createDieAnimator(elements.dieCube);
if (snapshot.lastRoll?.face) dieAnimator.showFace(snapshot.lastRoll.face);

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = isDark ? "#111713" : "#f5f5f1";
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
  elements.themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  elements.themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  localStorage.setItem("remorse-theme", isDark ? "dark" : "light");
}

applyTheme(localStorage.getItem("remorse-theme") === "dark" ? "dark" : "light");
elements.themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

elements.lobbyName.value = sessionStorage.getItem("remorse-lobby-name") ?? "";

const statusType = (type) => type[0].toUpperCase() + type.slice(1);
const playerLabel = (color) => color === "white" ? "White" : "Black";
const pieceById = (id) => snapshot.position.pieces.find((piece) => piece.id === id);

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3400);
}

function setConnection(kind, text) {
  elements.connection.className = `connection ${kind}`;
  elements.connection.lastElementChild.textContent = text;
}

function setRoomStorage() {
  if (!roomId || !sessionStorage.getItem("remorse-seat-token")) return;
  sessionStorage.setItem("remorse-room-id", roomId);
  sessionStorage.setItem("remorse-seat-color", seatColor ?? "");
}

function clearRoomStorage() {
  sessionStorage.removeItem("remorse-room-id");
  sessionStorage.removeItem("remorse-seat-token");
  sessionStorage.removeItem("remorse-seat-color");
}

function setGameState(next) {
  if (!next || typeof next.revision !== "number") return;
  if (snapshot && next.matchId === snapshot.matchId && next.revision < snapshot.revision) return;
  const resolvedRoll = snapshot?.phase.kind === "awaiting-roll"
    && next.phase.kind !== "awaiting-roll"
    ? next.phase.kind === "awaiting-bonus" ? next.phase.roll : next.lastRoll
    : null;
  const changedRoom = !snapshot || snapshot.matchId !== next.matchId;
  snapshot = next;
  demoMode = false;
  if (changedRoom) {
    bottomColor = seatColor ?? "white";
    elements.orientation.value = bottomColor;
  }
  selectedSquare = null;
  legalSquares = [];
  pendingAction = null;
  pendingActionKey = null;
  actionIds.clear();
  if (changedRoom) {
    elements.activity.textContent = `Game ${next.matchId.slice(0, 8)} is ready.`;
  }
  if (resolvedRoll?.face) {
    const face = resolvedRoll.face;
    if (rollLandingTimer) clearTimeout(rollLandingTimer);
    if (rollAnimationStartedAt) {
      const remaining = Math.max(0, 900 - (performance.now() - rollAnimationStartedAt));
      rollLandingTimer = setTimeout(() => dieAnimator.land(face), remaining);
    } else {
      dieAnimator.rollTo(face);
    }
    rollAnimationStartedAt = 0;
  } else if (changedRoom && next.lastRoll?.face) {
    dieAnimator.showFace(next.lastRoll.face);
  }
  render();
}

function boardPieces() {
  return new Map(snapshot.position.pieces.map((piece) => [piece.square, piece]));
}

function describePiece(piece) {
  if (!piece) return "empty square";
  const status = piece.status ? `, ${glyphStatus[piece.status.kind]?.label ?? piece.status.kind}, ${piece.status.remainingTurns} turns remaining` : "";
  return `${playerLabel(piece.color)} ${piece.type}${status}`;
}

function createChip(status) {
  const definition = glyphStatus[status.kind];
  if (!definition) return null;
  const chip = document.createElement("span");
  chip.className = `status-chip ${status.kind}`;
  const mark = document.createElement("span");
  mark.className = "status-chip-symbol";
  mark.textContent = definition.mark;
  mark.setAttribute("aria-hidden", "true");
  const count = document.createElement("span");
  count.className = "status-chip-count";
  count.textContent = status.remainingTurns;
  count.setAttribute("aria-hidden", "true");
  chip.append(mark, count);
  chip.setAttribute("aria-label", `${definition.label}, ${status.remainingTurns} turns remaining`);
  return chip;
}

function createPieceSculpture(piece) {
  const sculpture = document.createElement("span");
  sculpture.className = `piece-sculpture ${piece.type} ${piece.color}-model`;
  sculpture.setAttribute("aria-hidden", "true");
  const base = document.createElement("span");
  base.className = "piece-base";
  const upright = document.createElement("span");
  upright.className = "piece-upright";
  for (const part of ["piece-stem", "piece-collar", "piece-cap"]) {
    const shape = document.createElement("span");
    shape.className = part;
    upright.append(shape);
  }
  sculpture.append(base, upright);
  return sculpture;
}

function renderBoard() {
  initializeBoardCamera(elements.board);
  orientBoardForPlayer(elements.board, bottomColor);
  const pieces = boardPieces();
  const squares = getDisplaySquares(bottomColor);
  const files = bottomColor === "white" ? "abcdefgh".split("") : "hgfedcba".split("");
  const ranks = bottomColor === "white" ? "87654321".split("") : "12345678".split("");
  elements.ranks.replaceChildren(...ranks.map((rank) => {
    const label = document.createElement("span");
    label.textContent = rank;
    return label;
  }));
  elements.files.replaceChildren(...files.map((file) => {
    const label = document.createElement("span");
    label.textContent = squareNames[file];
    return label;
  }));
  elements.board.replaceChildren(...squares.map((square, index) => {
    const fileIndex = "abcdefgh".indexOf(square[0]);
    const rankIndex = Number(square[1]) - 1;
    const piece = pieces.get(square);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `square ${(fileIndex + rankIndex) % 2 === 0 ? "light" : "dark"}`;
    button.dataset.square = square;
    button.dataset.fileLabel = squareNames[square[0]];
    button.dataset.rankLabel = square[1];
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", `${square}, ${describePiece(piece)}`);
    if (index >= 56) {
      const coordinate = document.createElement("span");
      coordinate.className = "square-coordinate file-coordinate";
      coordinate.textContent = squareNames[square[0]];
      coordinate.setAttribute("aria-hidden", "true");
      button.append(coordinate);
    }
    if (index % 8 === 0) {
      const coordinate = document.createElement("span");
      coordinate.className = "square-coordinate rank-coordinate";
      coordinate.textContent = square[1];
      coordinate.setAttribute("aria-hidden", "true");
      button.append(coordinate);
    }
    if (square === selectedSquare) button.classList.add("selected");
    if (legalSquares.includes(square)) button.classList.add("legal");
    if (piece) {
      button.classList.add("has-piece");
      const token = document.createElement("span");
      token.className = `piece-token ${piece.color}-piece`;
      token.append(createPieceSculpture(piece));
      if (piece.status) {
        const chip = createChip(piece.status);
        if (chip) token.append(chip);
      }
      button.append(token);
    }
    return button;
  }));
}

function getTurnPiece() {
  if (snapshot.phase.kind === "awaiting-bonus") return pieceById(snapshot.phase.capture.capturingPieceId);
  return null;
}

function renderDie() {
  const phase = snapshot.phase;
  const awaitingRoll = phase.kind === "awaiting-roll";
  const awaitingBonus = phase.kind === "awaiting-bonus";
  const finished = phase.kind === "finished";
  const roll = awaitingBonus ? phase.roll : snapshot.lastRoll;
  elements.dieFace.textContent = roll ? String(roll.face) : "—";
  elements.dieFace.classList.toggle("empty", !roll);
  if (roll) {
    const effect = roll.effect === "none" ? "No new effect" : glyphStatus[roll.effect]?.label ?? statusType(roll.effect);
    const piece = pieceById(roll.pieceId);
    elements.dieCopy.textContent = `${effect} for ${piece ? `${playerLabel(piece.color)} ${piece.type}` : "the capturing piece"}.`;
  } else if (awaitingRoll) {
    const piece = pieceById(phase.capture.capturingPieceId);
    elements.dieCopy.textContent = `${playerLabel(phase.player)} captured${piece ? ` with a ${piece.type}` : ""}. Roll to resolve it.`;
  } else {
    elements.dieCopy.textContent = "A capture will call for a roll.";
  }
  const isCapturer = seatColor === (awaitingRoll || awaitingBonus ? phase.player : null);
  const controls = getDieControlState({ phase, isCapturer, connected, demoMode, pendingAction });
  elements.roll.hidden = controls.rollHidden;
  elements.roll.disabled = controls.rollDisabled;
  elements.rollLabel.textContent = controls.rollLabel;
  elements.roll.setAttribute("aria-label", controls.rollLabel);
  elements.skip.hidden = controls.skipHidden;
  elements.skip.disabled = controls.skipDisabled;
  elements.skip.textContent = controls.skipLabel;
  elements.dieNote.textContent = awaitingBonus
    ? "The first roll applies when this turn settles."
    : "Both players see the same roll.";
}

function renderTurn() {
  const phase = snapshot.phase;
  const currentColor = snapshot.position.activeColor;
  elements.turnIndicator.className = `turn-indicator ${currentColor}`;
  elements.revision.textContent = demoMode ? "PREVIEW" : `REV ${snapshot.revision}`;
  if (phase.kind === "finished") {
    const result = phase.result;
    elements.turnLabel.textContent = result.kind === "draw" ? `Draw · ${result.reason}` : `${playerLabel(result.winner)} wins · ${result.reason}`;
    elements.activity.textContent = result.kind === "draw" ? `The game ended in a draw (${result.reason}).` : `${playerLabel(result.winner)} won by ${result.reason}.`;
  } else if (phase.kind === "awaiting-roll") {
    elements.turnLabel.textContent = seatColor === phase.player ? "Your capture needs a roll" : `${playerLabel(phase.player)} must roll`;
    elements.activity.textContent = `${playerLabel(phase.player)} has captured. Play pauses until the die is rolled.`;
  } else if (phase.kind === "awaiting-bonus") {
    elements.turnLabel.textContent = seatColor === phase.player ? "Your bonus capture" : `${playerLabel(phase.player)} may take a bonus capture`;
    elements.activity.textContent = "The capturing piece can take one more piece or skip the bonus.";
  } else if (demoMode) {
    elements.turnLabel.textContent = "Preview board";
    elements.activity.textContent = demoMessage;
  } else if (!opponentJoined) {
    elements.turnLabel.textContent = "Waiting for a player";
    elements.activity.textContent = "The match starts when Black joins the invite.";
  } else {
    elements.turnLabel.textContent = seatColor === currentColor ? "Your turn" : `${playerLabel(currentColor)} to move`;
    elements.activity.textContent = `Move ${playerLabel(currentColor)} pieces. The server confirms the position.`;
  }
}

function renderRoom() {
  elements.lobby.hidden = !demoMode;
  elements.room.hidden = demoMode;
  if (demoMode) {
    elements.rejoin.hidden = !(sessionStorage.getItem("remorse-seat-token") && sessionStorage.getItem("remorse-room-id"));
    return;
  }
  elements.rejoin.hidden = true;
  elements.seat.textContent = seatColor ? `${playerLabel(seatColor)} seat` : "Spectating";
  elements.roomTitle.textContent = "Private match";
  elements.roomMessage.textContent = snapshot.phase.kind === "finished"
    ? "This match has ended. You can leave at any time."
    : !opponentJoined
      ? "Waiting for Black to join. Share the private invite when you are ready."
    : snapshot.position.activeColor === seatColor && snapshot.phase.kind === "active"
      ? "You are connected. It is your turn."
      : "You are connected to the private match.";
  elements.inviteShare.hidden = !inviteCode;
  if (inviteCode) {
    const link = new URL(location.href);
    link.search = "";
    link.searchParams.set("invite", inviteCode);
    elements.inviteLink.value = link.toString();
  }
  elements.resign.disabled = snapshot.phase.kind === "finished" || !opponentJoined || Boolean(pendingAction);
}

function lobbyActionButton(label, onClick, className = "button button-secondary lobby-action") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderLobby() {
  const isListed = Boolean(lobbySelf);
  elements.lobbyEntry.hidden = isListed;
  elements.lobbyDirectory.hidden = !isListed;
  elements.lobbyStatus.textContent = isListed
    ? `Listed as ${lobbySelf.displayName}. You appear while connected to the lobby.`
    : "Opt in to appear to other online guests.";

  if (!isListed) return;

  const busyGuestIds = new Set([...lobbyIncoming, ...lobbyOutgoing]
    .flatMap((challenge) => [challenge.fromGuestId, challenge.toGuestId]));
  const onlineRows = lobbyOnline.map((guest) => {
    const row = document.createElement("li");
    row.className = "lobby-row-item";
    const name = document.createElement("span");
    name.className = "lobby-name";
    name.textContent = guest.displayName;
    const button = lobbyActionButton(busyGuestIds.has(guest.guestId) ? "Challenge pending" : "Challenge", () => {
      submitLobbyCommand({
        type: "challenge",
        guestToken: lobbySelf.guestToken,
        targetGuestId: guest.guestId,
      });
    });
    button.disabled = busyGuestIds.has(guest.guestId);
    row.append(name, button);
    return row;
  });
  if (onlineRows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "lobby-empty";
    empty.textContent = "No other guests are online yet.";
    onlineRows.push(empty);
  }
  elements.lobbyOnline.replaceChildren(...onlineRows);

  const challenges = [];
  for (const challenge of lobbyIncoming) {
    const item = document.createElement("div");
    item.className = "lobby-challenge";
    const body = document.createElement("div");
    body.className = "lobby-challenge-body";
    const title = document.createElement("span");
    title.className = "lobby-challenge-title";
    title.textContent = `${challenge.fromName} challenged you.`;
    const actions = document.createElement("div");
    actions.className = "lobby-challenge-actions";
    actions.append(
      lobbyActionButton("Accept", () => submitLobbyCommand({
        type: "respond", guestToken: lobbySelf.guestToken, challengeId: challenge.challengeId, accept: true,
      })),
      lobbyActionButton("Decline", () => submitLobbyCommand({
        type: "respond", guestToken: lobbySelf.guestToken, challengeId: challenge.challengeId, accept: false,
      }), "button button-quiet lobby-action"),
    );
    body.append(title, actions);
    item.append(body);
    challenges.push(item);
  }
  for (const challenge of lobbyOutgoing) {
    const item = document.createElement("div");
    item.className = "lobby-challenge";
    const body = document.createElement("div");
    body.className = "lobby-challenge-body";
    const title = document.createElement("span");
    title.className = "lobby-challenge-title";
    title.textContent = `Waiting for ${challenge.toName} to respond.`;
    const cancel = lobbyActionButton("Cancel", () => submitLobbyCommand({
      type: "cancel", guestToken: lobbySelf.guestToken, challengeId: challenge.challengeId,
    }), "button button-quiet lobby-action");
    body.append(title, cancel);
    item.append(body);
    challenges.push(item);
  }
  if (challenges.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lobby-empty";
    empty.textContent = "No challenges yet.";
    challenges.push(empty);
  }
  elements.lobbyChallenges.replaceChildren(...challenges);
}

function render() {
  renderBoard();
  renderTurn();
  renderDie();
  renderRoom();
  renderLobby();
  const canSelect = demoMode || (connected && Boolean(roomId) && opponentJoined && !pendingAction);
  if (demoMode) {
    elements.caption.textContent = "Preview board · status chips show their remaining turns.";
  } else if (snapshot.phase.kind === "awaiting-roll") {
    elements.caption.textContent = "No moves until the capturing player resolves the die.";
  } else if (snapshot.phase.kind === "awaiting-bonus") {
    elements.caption.textContent = "Choose a legal capture with the original capturing piece, or skip.";
  } else if (snapshot.phase.kind === "finished") {
    elements.caption.textContent = "This game is finished. Leave the room when you are ready.";
  } else if (!opponentJoined) {
    elements.caption.textContent = "Waiting for the other player to join before the game can begin.";
  } else if (!canSelect) {
    elements.caption.textContent = "Reconnect to your seat to continue this game.";
  } else {
    elements.caption.textContent = "Select one of your pieces, then choose a highlighted destination.";
  }
}

function isOurTurn(piece) {
  if (!piece || (!demoMode && !opponentJoined)) return false;
  const phase = snapshot.phase;
  if (phase.kind === "active") return piece.color === snapshot.position.activeColor && (!seatColor || piece.color === seatColor);
  if (phase.kind === "awaiting-bonus") return piece.id === phase.capture.capturingPieceId && (!seatColor || phase.player === seatColor);
  return false;
}

function moveFor(from, to, promotion) {
  const type = snapshot.phase.kind === "awaiting-bonus" ? "bonus-move" : "move";
  const move = { from, to };
  if (promotion) move.promotion = promotion;
  emitAction({ type, move });
}

function onSquareClick(square) {
  const phase = snapshot.phase;
  const interactive = demoMode || (connected && Boolean(roomId) && !pendingAction);
  if (!interactive || phase.kind === "awaiting-roll" || phase.kind === "finished") return;
  const pieces = boardPieces();
  const piece = pieces.get(square);
  if (selectedSquare && legalSquares.includes(square)) {
    if (!demoMode && pieceById(selectedPieceId())?.type === "pawn" && (square.endsWith("8") || square.endsWith("1"))) {
      pendingPromotion = { from: selectedSquare, to: square };
      elements.promotion.showModal();
    } else if (!demoMode) {
      moveFor(selectedSquare, square);
    }
    selectedSquare = null;
    legalSquares = [];
    renderBoard();
    return;
  }
  if (piece && isOurTurn(piece)) {
    selectedSquare = square;
    legalSquares = phase.kind === "awaiting-bonus"
      ? getCaptureDestinations(snapshot, piece.id)
      : getLegalDestinations(snapshot, piece.id);
  } else {
    selectedSquare = null;
    legalSquares = [];
  }
  renderBoard();
}

function selectedPieceId() {
  return snapshot.position.pieces.find((piece) => piece.square === selectedSquare)?.id;
}

function emitAction(command, retryEnvelope) {
  if (pendingAction) return;
  if (!socket || !connected || !roomId) {
    showToast("Connect to a private match before playing.");
    return;
  }
  const actionKey = `${snapshot.revision}:${JSON.stringify(command)}`;
  const actionId = retryEnvelope?.actionId ?? actionIds.get(actionKey) ?? crypto.randomUUID();
  actionIds.set(actionKey, actionId);
  const envelope = { actionId, expectedRevision: snapshot.revision, command };
  pendingAction = envelope;
  pendingActionKey = actionKey;
  socket.emit("action", envelope);
  elements.activity.textContent = "Waiting for the server to confirm this action…";
  renderDie();
  renderRoom();
  setTimeout(() => {
    if (pendingAction?.actionId !== actionId) return;
    pendingAction = null;
    render();
    showToast("No confirmation yet. Retry the action to reuse its original action ID.");
    elements.rollLabel.textContent = command.type === "request-roll" ? "Retry the roll" : elements.rollLabel.textContent;
    elements.skip.textContent = command.type === "skip-bonus" ? "Retry skip" : elements.skip.textContent;
  }, 4500);
}

function submitSession(command) {
  if (!socket) {
    showToast("The game server is not connected yet.");
    return;
  }
  if (!connected) {
    pendingSessionCommand = command;
    socket.connect();
    return;
  }
  socket.emit("session", command);
}

function submitLobbyCommand(command) {
  if (!socket) {
    showToast("The game server is not connected yet.");
    return;
  }
  if (!connected) {
    pendingLobbyCommand = command;
    socket.connect();
    return;
  }
  socket.emit("lobby", command);
}

function clearLobbyMembership(forgetIdentity = false) {
  lobbySelf = null;
  lobbyOnline = [];
  lobbyIncoming = [];
  lobbyOutgoing = [];
  sessionStorage.removeItem("remorse-lobby-opted-in");
  if (forgetIdentity) {
    sessionStorage.removeItem("remorse-lobby-guest-id");
    sessionStorage.removeItem("remorse-lobby-guest-token");
  }
  renderLobby();
}

function joinGuestLobby() {
  let displayName = elements.lobbyName.value.trim();
  if (!displayName) {
    displayName = `Guest ${Math.floor(Math.random() * 9000) + 1000}`;
    elements.lobbyName.value = displayName;
  }
  displayName = displayName.slice(0, 24);
  elements.lobbyName.value = displayName;
  sessionStorage.setItem("remorse-lobby-name", displayName);
  const guestToken = sessionStorage.getItem("remorse-lobby-guest-token");
  submitLobbyCommand({ type: "enter", displayName, ...(guestToken ? { guestToken } : {}) });
}

function normalizeInvite(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, location.origin);
    const fromQuery = url.searchParams.get("invite");
    if (fromQuery) return fromQuery;
    const match = url.pathname.match(/\/invite\/([^/]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    // Treat non-URL values as invite codes.
  }
  return trimmed;
}

function startSocket() {
  const connect = () => {
    if (typeof window.io !== "function") {
      setConnection("offline", "Server unavailable");
      return;
    }
    socket = window.io();
    socket.on("connect", () => {
      connected = true;
      setConnection("online", "Connected");
      if (pendingLobbyCommand) {
        const command = pendingLobbyCommand;
        pendingLobbyCommand = null;
        autoSessionSent = true;
        socket.emit("lobby", command);
      } else if (pendingSessionCommand) {
        const command = pendingSessionCommand;
        pendingSessionCommand = null;
        autoSessionSent = true;
        socket.emit("session", command);
      } else if (sessionStorage.getItem("remorse-seat-token") && sessionStorage.getItem("remorse-room-id") && !autoSessionSent) {
        autoSessionSent = true;
        pendingJoin = true;
        submitSession({
          type: "rejoin-room",
          roomId: sessionStorage.getItem("remorse-room-id"),
          seatToken: sessionStorage.getItem("remorse-seat-token"),
        });
      } else {
        const fromUrl = new URLSearchParams(location.search).get("invite");
        if (fromUrl && !autoSessionSent) {
          autoSessionSent = true;
          pendingJoin = true;
          submitSession({ type: "join-room", inviteCode: fromUrl });
        } else if (sessionStorage.getItem("remorse-lobby-opted-in") === "true"
          && sessionStorage.getItem("remorse-lobby-guest-token") && !autoSessionSent) {
          autoSessionSent = true;
          socket.emit("lobby", {
            type: "enter",
            displayName: sessionStorage.getItem("remorse-lobby-name") ?? "Guest",
            guestToken: sessionStorage.getItem("remorse-lobby-guest-token"),
          });
        }
      }
      render();
    });
    socket.on("disconnect", () => {
      connected = false;
      autoSessionSent = false;
      if (snapshot.phase.kind === "awaiting-roll") {
        rollAnimationStartedAt = 0;
        if (rollLandingTimer) clearTimeout(rollLandingTimer);
        dieAnimator.reset();
      }
      setConnection("offline", "Reconnecting");
      render();
    });
    socket.on("connect_error", () => setConnection("offline", "Server unavailable"));
    socket.on("message", (message) => {
      if (!message || typeof message.type !== "string") return;
      if (message.type === "room-created") {
        clearLobbyMembership();
        roomId = message.roomId;
        inviteCode = message.inviteCode;
        seatColor = "white";
        opponentJoined = false;
        sessionStorage.setItem("remorse-seat-token", message.seatToken);
        setRoomStorage();
        demoMessage = "Create an invite or join a private match to begin.";
        elements.roomMessage.textContent = "Invite ready. Share the link and wait for your guest.";
        elements.activity.textContent = "Private room created. Invite one player to take Black.";
        setGameState(message.state);
        showToast("Private invite created. Share the link to start.");
      } else if (message.type === "room-joined") {
        clearLobbyMembership();
        roomId = message.roomId;
        seatColor = message.color;
        inviteCode = null;
        opponentJoined = true;
        pendingJoin = false;
        sessionStorage.setItem("remorse-seat-token", message.seatToken);
        setRoomStorage();
        demoMessage = "Create an invite or join a private match to begin.";
        setGameState(message.state);
        showToast(`Joined as ${playerLabel(seatColor)}.`);
      } else if (message.type === "state") {
        opponentJoined = true;
        inviteCode = null;
        setGameState(message.state);
      } else if (message.type === "room-closed") {
        rollAnimationStartedAt = 0;
        if (rollLandingTimer) clearTimeout(rollLandingTimer);
        dieAnimator.reset();
        roomId = null;
        seatColor = null;
        inviteCode = null;
        opponentJoined = false;
        clearRoomStorage();
        snapshot = previewSnapshot;
        demoMode = true;
        selectedSquare = null;
        demoMessage = "This private invite is no longer active.";
        showToast("This private match has ended because both players left.");
        render();
      } else if (message.type === "error") {
        if (snapshot.phase.kind === "awaiting-roll") {
          rollAnimationStartedAt = 0;
          if (rollLandingTimer) clearTimeout(rollLandingTimer);
          dieAnimator.reset();
        }
        pendingAction = null;
        if (message.code === "room-unavailable" && pendingJoin) {
          pendingJoin = false;
          roomId = null;
          seatColor = null;
          inviteCode = null;
          opponentJoined = false;
          clearRoomStorage();
          snapshot = previewSnapshot;
          demoMode = true;
          demoMessage = "This private invite is no longer active.";
          showToast("This invite is no longer active. Ask for a new invite link.");
        } else {
          elements.activity.textContent = message.message;
          showToast(message.message || "The server could not accept that action.");
        }
        render();
      }
    });
    socket.on("lobby-message", (message) => {
      if (!message || typeof message.type !== "string") return;
      if (message.type === "lobby-state") {
        lobbySelf = message.self;
        lobbyOnline = message.online;
        lobbyIncoming = message.incoming;
        lobbyOutgoing = message.outgoing;
        elements.lobbyName.value = message.self.displayName;
        sessionStorage.setItem("remorse-lobby-guest-id", message.self.guestId);
        sessionStorage.setItem("remorse-lobby-guest-token", message.self.guestToken);
        sessionStorage.setItem("remorse-lobby-name", message.self.displayName);
        sessionStorage.setItem("remorse-lobby-opted-in", "true");
        renderLobby();
      } else if (message.type === "lobby-left") {
        clearLobbyMembership(true);
      } else if (message.type === "lobby-error") {
        if (message.code === "guest-unavailable" && !lobbySelf) clearLobbyMembership(true);
        elements.lobbyStatus.textContent = message.message;
        showToast(message.message || "The lobby could not accept that action.");
        renderLobby();
      }
    });
  };

  if (typeof window.io === "function") {
    connect();
    return;
  }
  const script = document.createElement("script");
  script.src = "/socket.io/socket.io.js";
  script.onload = connect;
  script.onerror = () => setConnection("offline", "Preview mode");
  document.head.append(script);
}

elements.board.addEventListener("click", (event) => {
  const square = event.target.closest("[data-square]")?.dataset.square;
  if (square) onSquareClick(square);
});
elements.board.addEventListener("keydown", (event) => {
  if (!event.key.startsWith("Arrow")) return;
  const current = event.target.closest("[data-square]")?.dataset.square;
  if (!current) return;
  const file = "abcdefgh".indexOf(current[0]);
  const rank = Number(current[1]) - 1;
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
  const nextFile = file + delta[0] * (bottomColor === "white" ? 1 : -1);
  const nextRank = rank + delta[1] * (bottomColor === "white" ? 1 : -1);
  if (nextFile >= 0 && nextFile < 8 && nextRank >= 0 && nextRank < 8) {
    event.preventDefault();
    elements.board.querySelector(`[data-square="${"abcdefgh"[nextFile]}${nextRank + 1}"]`)?.focus();
  }
});
elements.orientation.addEventListener("change", () => {
  bottomColor = elements.orientation.value;
  renderBoard();
});
elements.create.addEventListener("click", () => submitSession({ type: "create-room" }));
elements.rejoin.addEventListener("click", () => {
  if (!socket) {
    showToast("The game server is not connected yet.");
    return;
  }
  autoSessionSent = false;
  if (!connected) socket.connect();
  else {
    autoSessionSent = true;
    pendingJoin = true;
    submitSession({
      type: "rejoin-room",
      roomId: sessionStorage.getItem("remorse-room-id"),
      seatToken: sessionStorage.getItem("remorse-seat-token"),
    });
  }
});
elements.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = normalizeInvite(elements.inviteCode.value);
  if (!code) {
    showToast("Enter a valid invite code or link.");
    return;
  }
  pendingJoin = true;
  submitSession({ type: "join-room", inviteCode: code });
});
elements.lobbyName.addEventListener("input", () => {
  sessionStorage.setItem("remorse-lobby-name", elements.lobbyName.value.slice(0, 24));
});
elements.lobbyJoin.addEventListener("click", joinGuestLobby);
elements.lobbyLeave.addEventListener("click", () => {
  if (!lobbySelf) return;
  submitLobbyCommand({ type: "leave", guestToken: lobbySelf.guestToken });
});
elements.roll.addEventListener("click", () => {
  rollAnimationStartedAt = performance.now();
  dieAnimator.startRoll();
  emitAction({ type: "request-roll" });
});
elements.skip.addEventListener("click", () => emitAction({ type: "skip-bonus" }));
elements.resign.addEventListener("click", () => emitAction({ type: "resign" }));
elements.leave.addEventListener("click", () => {
  if (socket && connected) socket.disconnect();
  rollAnimationStartedAt = 0;
  if (rollLandingTimer) clearTimeout(rollLandingTimer);
  dieAnimator.reset();
  connected = false;
  roomId = null;
  seatColor = null;
  inviteCode = null;
  opponentJoined = false;
  pendingAction = null;
  pendingJoin = false;
  snapshot = previewSnapshot;
  demoMode = true;
  demoMessage = "You left the room. Rejoin only while the other player stays connected.";
  elements.inviteCode.value = "";
  elements.activity.textContent = "You left the room. Rejoin only while the other player stays connected.";
  setConnection("offline", "Left room");
  render();
});
elements.copyInvite.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.inviteLink.value);
    showToast("Invite link copied.");
  } catch {
    elements.inviteLink.select();
    document.execCommand("copy");
    showToast("Invite link selected. Copy it to share.");
  }
});
elements.promotion.querySelectorAll("[data-promotion]").forEach((button) => {
  button.addEventListener("click", () => {
    const promotion = button.dataset.promotion;
    if (pendingPromotion) moveFor(pendingPromotion.from, pendingPromotion.to, promotion);
    pendingPromotion = null;
    elements.promotion.close();
  });
});
elements.promotion.addEventListener("close", () => { pendingPromotion = null; });

const inviteFromUrl = new URLSearchParams(location.search).get("invite");
if (inviteFromUrl) elements.inviteCode.value = inviteFromUrl;
render();
startSocket();
