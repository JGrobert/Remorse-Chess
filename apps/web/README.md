# Web client

The client is a dependency-free static workspace. `npm run build --workspace @remorse-chess/web` copies `index.html` and browser modules into `apps/web/dist` for the same-origin server to serve.

The live client loads Socket.IO from `/socket.io/socket.io.js`, emits `session` with a shared-protocol `SessionCommand`, emits `action` with `ClientActionEnvelope`, and listens for `message` containing `ServerMessage`. A seat token and room ID live in `sessionStorage` so a refreshed tab can rejoin while the other player remains connected. Leaving disconnects the socket without resigning; resignation is a separate action.

The board uses a local fixture for preview and local legal-move highlights. The server remains authoritative and validates each live move. During a pending roll only the capturer's seat can roll; the returned snapshot supplies the same die result to both players. The UI displays one of the red, amber, or purple status chips with a symbol and remaining-turn count.
