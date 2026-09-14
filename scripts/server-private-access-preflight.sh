#!/usr/bin/env sh
set -eu

# Read-only server-side inventory. This script does not install packages,
# alter sshd/firewall rules, restart services, or print credentials.

printf '%s\n' 'PRIVATE_ACCESS_PREFLIGHT=START'
printf 'HOSTNAME=%s\n' "$(hostname)"
printf 'OS_ID=%s\n' "$(awk -F= '$1=="ID"{gsub(/"/,"",$2);print $2}' /etc/os-release 2>/dev/null || printf unknown)"
printf 'TAILSCALE_INSTALLED=%s\n' "$(command -v tailscale >/dev/null 2>&1 && printf YES || printf NO)"
printf 'TAILSCALED_ACTIVE=%s\n' "$(systemctl is-active --quiet tailscaled 2>/dev/null && printf YES || printf NO)"
if systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null; then
  printf '%s\n' 'SSH_ACTIVE=YES'
else
  printf '%s\n' 'SSH_ACTIVE=NO'
fi

if command -v tailscale >/dev/null 2>&1; then
  printf 'TAILSCALE_IPV4_PRESENT=%s\n' "$(tailscale ip -4 >/dev/null 2>&1 && printf YES || printf NO)"
  printf 'TAILSCALE_STATUS=%s\n' "$(tailscale status >/dev/null 2>&1 && printf HEALTHY || printf NEEDS_LOGIN)"
fi

if command -v ss >/dev/null 2>&1; then
  printf 'SSH_LISTENER_PRESENT=%s\n' "$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)22$' && printf YES || printf NO)"
fi

printf '%s\n' 'PRIVATE_ACCESS_PREFLIGHT=COMPLETE'
