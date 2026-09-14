# Private server access

Target architecture: the administrator's Windows computer and
`servidor-barberia` join the same private Tailscale network. SSH remains
key-only and is reached through the server's Tailscale IP/name. The public
Internet must not receive a new SSH exposure.

This document does not authorize installation, firewall edits, service
restarts, or credential rotation.

## Current gate

The last read-only connection to the existing `servidor-barberia` SSH alias
timed out. Do not repeatedly reconnect or infer server state from repository
files. The first human action is to restore one existing authorized console,
LAN SSH, or provider-console session.

## Server preflight

From that authorized session, run:

```sh
sh scripts/server-private-access-preflight.sh
```

Record only the booleans and OS id. Do not copy environment variables,
Tailscale auth keys, SSH private keys, Docker secrets, or application
credentials.

## Controlled installation

1. Follow the official Tailscale installation instructions for the observed OS.
   Do not pipe an unreviewed remote script directly into a privileged shell.
2. Start `tailscaled` using the OS package/service manager.
3. Run `sudo tailscale up --ssh=false` interactively. Open its authorization
   URL yourself and authenticate to the approved Tailscale organization.
4. Do not use a reusable auth key in chat, a repository file, shell history, or
   an application environment file.
5. Confirm the Windows computer is in the same tailnet, then test a new SSH
   session to the private Tailscale hostname/IP with the existing SSH key.
6. Verify Docker/n8n/Evolution health read-only. Do not restart containers as
   part of network enrollment.

Only after the private session is proven should a separate authorized change
restrict a public SSH firewall rule. Keep the current session open, validate a
second private session first, and maintain provider-console recovery.

## Verification

- Tailscale reports both devices online.
- A new key-based SSH session succeeds over the Tailscale address.
- Password and keyboard-interactive SSH remain disabled.
- n8n, Evolution and Cloudflared remain healthy.
- No application port, secret, workflow, container or DNS record changed.

## Rollback

If private SSH fails, keep the existing access path unchanged and stop. If the
Tailscale enrollment itself must be reversed, use `sudo tailscale down`; do not
uninstall packages or delete state until ordinary SSH and provider-console
recovery have been reconfirmed.
