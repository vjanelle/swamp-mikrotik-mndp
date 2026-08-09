# @randomfrequency/mikrotik-mndp

WinBox-style MikroTik Neighbor Discovery Protocol (MNDP) discovery for Swamp.

The model listens on UDP port `5678`, decodes RouterOS MNDP advertisements, and
stores discovered devices as queryable `neighbor` resources. It is read-only and
does not require a DHCP address, RouterOS credentials, or REST access.

## Usage

```bash
swamp extension pull @randomfrequency/mikrotik-mndp
swamp model create @randomfrequency/mikrotik-mndp neighbors
swamp model method run neighbors discover --input timeoutMs=5000
swamp data query neighbors 'attributes.platform == "MikroTik"'
```

The Swamp host must be on the same Layer-2 network as the device, and MNDP must
be enabled on the relevant RouterOS interface list. The default listen port is
UDP `5678`.

## How Discovery Works

MNDP is the unauthenticated Layer-2 protocol used by WinBox to show nearby
RouterOS devices. The model binds an IPv4 UDP socket to port `5678`, listens for
RouterOS advertisements, decodes the sequence number and typed TLV fields, and
writes one resource per device/interface advertisement. It does not scan IP
ranges and it does not make REST or RouterOS API calls. This means it can find a
switch whose DHCP address changed, provided the Swamp process can receive local
broadcast traffic.

The default listen window is five seconds, which is convenient for interactive
checks. RouterOS commonly advertises every 30 seconds, so use a longer window
for reliable inventory collection:

```bash
swamp model method run neighbors discover --input timeoutMs=60000
swamp data query neighbors 'attributes.board == "CRS309-1G-8S+"'
```

Each resource includes the MAC address, identity, RouterOS version, board,
uptime, interface name, source address, and advertised IPv4 addresses. Multiple
interfaces on one switch can produce multiple resources; use `macAddress` and
`sourceAddress` when correlating them.

## WSL2 and Firewalls

Default WSL2 NAT networking generally does not deliver Layer-2 broadcast
traffic into the Linux environment. On supported Windows 11/WSL releases,
enable mirrored networking in `%UserProfile%\\.wslconfig`, then restart WSL:

```ini
[wsl2]
networkingMode=mirrored
firewall=true
```

```powershell
wsl --shutdown
```

Allow inbound UDP `5678` on the Windows Private network profile if Windows
Firewall blocks the packets. If mirrored networking is unavailable, run Swamp
on Windows or use a Layer-2-connected Linux host.

## Security

MNDP is unauthenticated and exposes device metadata on the local broadcast
domain. Use RouterOS discovery-interface settings to limit where it is enabled.
