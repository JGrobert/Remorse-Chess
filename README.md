# Remorse Chess

An online chess variant built around a deterministic rules engine, private matches, and a server-authoritative multiplayer game.

## Local development

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The production server serves the compiled web client and Socket.IO from one origin:

```sh
npm run build
npm start --workspace @remorse-chess/server
```

Open `http://127.0.0.1:8080/`. Rooms are held in memory and disappear when both players leave or the server restarts.

## Deterministic browser playtest

The local harness uses the real engine, server, Socket.IO transport, and web app with a small fixture and a fixed die sequence. Open two isolated browser sessions at the URL it prints.

```sh
npm run build
npm run playtest:fixture
```

See [the playtest checklist and report](tests/e2e/README.md). This harness is not part of the production container.

## Guest lobby

The optional lobby lists only guests who opt in and are currently connected. A challenge can be accepted or declined; acceptance starts the same private room used by invite links. Presence and games are in memory and disappear when the server restarts. The browser keeps an anonymous guest token in the current tab's session storage so a reconnect can restore the same lobby identity. Package 7 adds separate `lobby` and `lobby-message` Socket.IO events with new protocol types; the existing `session`, `action`, and `message` contracts are unchanged.

## Docker and deployment

Run the single-container setup locally with:

```sh
docker compose up --build -d
curl --fail http://127.0.0.1:8080/healthz
docker compose down
```

The port is bound to loopback. Put the app behind the existing Nginx with HTTPS and WebSocket proxying; do not expose port 8080 publicly. Host setup, Nginx configuration, health checks, and rollback steps are in [deploy/README.md](deploy/README.md).

## Project structure

Workspace packages live under `packages/` and `apps/`. Shared game contracts live in `packages/protocol/`; rules are in `packages/engine/`, room/lobby handling in `apps/server/`, and the browser client in `apps/web/`. The accepted rules and package plan are in [BUILD_PLAN.md](BUILD_PLAN.md).
