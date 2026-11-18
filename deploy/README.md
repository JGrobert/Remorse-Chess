# Deploy Remorse Chess behind the existing Nginx

The Compose service runs one Node container and publishes port `8080` only on loopback. Keep the public HTTP and HTTPS ports on the VM's existing Nginx; do not open `8080` in the VM firewall or OCI security lists.

## Prepare the host

1. Check the VM's Linux distribution and CPU architecture, then install Docker Engine and the Compose plugin using Docker's instructions for that host.
2. Point a dedicated hostname such as `chess.example.com` at the VM and issue an HTTPS certificate for it using the site's normal certificate process.
3. Copy `deploy/nginx-remorse.example.conf` into the existing Nginx `http {}` include directory. Replace the example hostname and certificate paths. Keep the existing sites' configuration in place.

## Build and start

From the repository root on the VM:

```sh
docker compose -f compose.yaml build
docker compose -f compose.yaml up -d
docker compose -f compose.yaml ps
curl --fail http://127.0.0.1:8080/healthz
```

Check the Nginx configuration before reloading it:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Then open `https://chess.example.com`, create an invite, and verify the Socket.IO connection and game through the HTTPS hostname. Check the site's existing hostnames as well. Keep Nginx's WebSocket upgrade headers and long read timeout for `/socket.io/` so both WebSocket and polling transports work.

## Rollback

Tag the known-good image before replacing it, for example `remorse-chess:release-2026-11-17`, and record the tag in the deployment notes. If the new release fails, restore the prior tag in Compose, then run `docker compose -f compose.yaml up -d`. Recheck `nginx -t` and reload only if the Nginx configuration changed. Rooms are memory-only, so rollback or container replacement discards active matches; tell players to start a fresh invite.
