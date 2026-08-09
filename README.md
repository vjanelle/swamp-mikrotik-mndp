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

## Security

MNDP is unauthenticated and exposes device metadata on the local broadcast
domain. Use RouterOS discovery-interface settings to limit where it is enabled.
