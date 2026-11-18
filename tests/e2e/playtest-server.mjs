// Local-only browser playtest harness. This file is outside the Docker build
// context and is never imported by the production server.
process.env.NODE_ENV = "test";

const [{ RemorseChessEngine }, { createHttpServer, attachRealtimeServer, RoomManager }] = await Promise.all([
  import("../../packages/engine/dist/index.js"),
  import("../../apps/server/dist/index.js"),
]);

const rules = new RemorseChessEngine();
const noCastling = {
  white: { kingSide: false, queenSide: false },
  black: { kingSide: false, queenSide: false },
};

const fixtureEngine = {
  createInitialGame(matchId) {
    return {
      matchId,
      revision: 0,
      position: {
        pieces: [
          { id: "white-king", color: "white", type: "king", square: "e1" },
          { id: "black-king", color: "black", type: "king", square: "h8" },
          {
            id: "white-rook",
            color: "white",
            type: "rook",
            square: "a1",
            status: { kind: "psycho", remainingTurns: 3 },
          },
          { id: "black-pawn-a", color: "black", type: "pawn", square: "a7" },
          { id: "black-pawn-b", color: "black", type: "pawn", square: "b7" },
        ],
        activeColor: "white",
        castlingRights: noCastling,
        enPassantSquare: null,
        halfmoveClock: 0,
        fullmoveNumber: 1,
      },
      phase: { kind: "active" },
      lastRoll: null,
    };
  },
  getLegalMoves: (...args) => rules.getLegalMoves(...args),
  applyAction: (...args) => rules.applyAction(...args),
};

const faces = [1, 2, 3, 4, 5, 6, 4, 1, 2, 3, 4, 5, 6];
const manager = new RoomManager(fixtureEngine, {
  randomFace() {
    const face = faces.shift() ?? 4;
    process.stdout.write(`E2E die face: ${face}\n`);
    return face;
  },
});

const server = createHttpServer();
attachRealtimeServer(server, manager);
const port = Number(process.env.E2E_PORT ?? 8081);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Local browser playtest server listening on http://127.0.0.1:${port}\n`);
});

function close() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
