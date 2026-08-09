/**
 * Discover MikroTik neighbors using the same UDP protocol used by WinBox.
 *
 * MNDP is a passive Layer-2 discovery protocol. RouterOS devices advertise
 * packets on UDP port 5678; this model listens briefly and stores each
 * neighbor as a queryable resource.
 */
import dgram from "node:dgram";
import { z } from "npm:zod@4";

const DiscoverArgsSchema = z.object({
  timeoutMs: z.number().int().min(250).max(120_000).default(5_000).describe(
    "How long to listen for MNDP advertisements",
  ),
  port: z.number().int().min(1).max(65_535).default(5678).describe(
    "UDP port used by MNDP",
  ),
});

const NeighborSchema = z.object({
  sequence: z.number().int().nonnegative(),
  macAddress: z.string(),
  identity: z.string(),
  version: z.string(),
  platform: z.string(),
  board: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  interfaceName: z.string(),
  addresses: z.array(z.string()),
  sourceAddress: z.string(),
  discoveredAt: z.iso.datetime(),
});

type Neighbor = z.infer<typeof NeighborSchema>;

interface MessageInfo {
  address: string;
}

interface DatagramSocket {
  bind(options: { address: string; port: number }): void;
  close(callback?: () => void): void;
  on(
    event: "message",
    listener: (message: Uint8Array, info: MessageInfo) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
}

interface DatagramModule {
  createSocket(options: { type: "udp4"; reuseAddr: boolean }): DatagramSocket;
}

const UDP = dgram as unknown as DatagramModule;

function readText(packet: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(packet.subarray(start, start + length));
}

function readIpv4(
  packet: Uint8Array,
  start: number,
  length: number,
): string | null {
  if (length !== 4) return null;
  return Array.from(packet.subarray(start, start + length)).join(".");
}

export function readTlvs(
  packet: Uint8Array,
): Omit<Neighbor, "sourceAddress" | "discoveredAt"> | null {
  if (packet.length < 4) return null;

  const view = new DataView(
    packet.buffer,
    packet.byteOffset,
    packet.byteLength,
  );
  const values = {
    sequence: view.getUint32(0, true),
    macAddress: "",
    identity: "",
    version: "",
    platform: "",
    board: "",
    uptimeSeconds: 0,
    interfaceName: "",
    addresses: [] as string[],
  };

  let offset = 4;
  while (offset + 4 <= packet.length) {
    const type = view.getUint16(offset, false);
    const length = view.getUint16(offset + 2, false);
    offset += 4;
    if (offset + length > packet.length) return null;

    switch (type) {
      case 1:
        values.macAddress = Array.from(packet.subarray(offset, offset + length))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(":");
        break;
      case 5:
        values.identity = readText(packet, offset, length);
        break;
      case 7:
        values.version = readText(packet, offset, length);
        break;
      case 8:
        values.platform = readText(packet, offset, length);
        break;
      case 10:
        if (length === 4) values.uptimeSeconds = view.getUint32(offset, true);
        break;
      case 12:
        values.board = readText(packet, offset, length);
        break;
      case 16:
        values.interfaceName = readText(packet, offset, length);
        break;
      case 17: {
        const address = readIpv4(packet, offset, length);
        if (address) values.addresses.push(address);
        break;
      }
      default:
        break;
    }
    offset += length;
  }

  return values.macAddress ? values : null;
}

function resourceName(neighbor: Neighbor): string {
  return `neighbor-${
    (neighbor.macAddress || neighbor.sourceAddress).replace(
      /[^A-Za-z0-9._-]/g,
      "_",
    )
  }`;
}

async function discover(
  timeoutMs: number,
  port: number,
  signal: AbortSignal | undefined,
): Promise<Neighbor[]> {
  const socket = UDP.createSocket({ type: "udp4", reuseAddr: true });
  const neighbors = new Map<string, Neighbor>();

  return await new Promise<Neighbor[]>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close(() =>
        error ? reject(error) : resolve([...neighbors.values()])
      );
    };

    const timer = setTimeout(() => finish(), timeoutMs);
    socket.on("error", (error) => finish(error));
    socket.on("message", (message, info) => {
      const decoded = readTlvs(message);
      if (!decoded) return;
      const neighbor: Neighbor = {
        ...decoded,
        sourceAddress: info.address,
        discoveredAt: new Date().toISOString(),
      };
      neighbors.set(
        `${neighbor.macAddress}|${neighbor.sourceAddress}|${neighbor.interfaceName}`,
        neighbor,
      );
    });

    if (signal) {
      if (signal.aborted) return finish(new Error("Discovery was cancelled"));
      signal.addEventListener(
        "abort",
        () => finish(new Error("Discovery was cancelled")),
        {
          once: true,
        },
      );
    }

    try {
      socket.bind({ address: "0.0.0.0", port });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export const model = {
  type: "@randomfrequency/mikrotik-mndp",
  version: "2026.08.08.1",
  resources: {
    neighbor: {
      description: "A MikroTik neighbor discovered through MNDP",
      schema: NeighborSchema,
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
  methods: {
    discover: {
      description:
        "Listen for WinBox-compatible MikroTik Neighbor Discovery Protocol advertisements",
      arguments: DiscoverArgsSchema,
      execute: async (
        args: z.infer<typeof DiscoverArgsSchema>,
        context: {
          signal?: AbortSignal;
          logger?: {
            info: (
              message: string,
              properties?: Record<string, unknown>,
            ) => void;
          };
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
        },
      ) => {
        context.logger?.info("Listening for MikroTik MNDP advertisements", {
          timeoutMs: args.timeoutMs,
          port: args.port,
        });
        const neighbors = await discover(
          args.timeoutMs,
          args.port,
          context.signal,
        );
        const dataHandles = await Promise.all(
          neighbors.map((neighbor) =>
            context.writeResource("neighbor", resourceName(neighbor), neighbor)
          ),
        );
        context.logger?.info("Completed MikroTik MNDP discovery", {
          neighbors: neighbors.length,
        });
        return { dataHandles };
      },
    },
  },
};
