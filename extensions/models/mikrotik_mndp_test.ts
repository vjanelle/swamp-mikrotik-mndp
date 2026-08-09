import { assertEquals, assert } from "jsr:@std/assert@1.0.2";
import { readTlvs } from "./mikrotik_mndp.ts";

function packet(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function tlv(type: number, value: number[]): number[] {
  return [type >> 8, type & 0xff, value.length >> 8, value.length & 0xff, ...value];
}

Deno.test("decodes MNDP identity, hardware, address, and uptime TLVs", () => {
  const text = (value: string) => [...new TextEncoder().encode(value)];
  const decoded = readTlvs(packet(
    0x78,
    0x56,
    0x34,
    0x12,
    ...tlv(1, [0x2c, 0xC8, 0x1B, 0xAA, 0xBB, 0xCC]),
    ...tlv(5, text("switch")),
    ...tlv(7, text("7.16.2")),
    ...tlv(8, text("MikroTik")),
    ...tlv(10, [0x2A, 0x00, 0x00, 0x00]),
    ...tlv(12, text("CRS309-1G-8S+")),
    ...tlv(16, text("bridge")),
    ...tlv(17, [192, 168, 88, 1]),
  ));

  assert(decoded);
  assertEquals(decoded.sequence, 0x12345678);
  assertEquals(decoded.macAddress, "2c:c8:1b:aa:bb:cc");
  assertEquals(decoded.identity, "switch");
  assertEquals(decoded.version, "7.16.2");
  assertEquals(decoded.platform, "MikroTik");
  assertEquals(decoded.board, "CRS309-1G-8S+");
  assertEquals(decoded.uptimeSeconds, 42);
  assertEquals(decoded.interfaceName, "bridge");
  assertEquals(decoded.addresses, ["192.168.88.1"]);
});

Deno.test("rejects truncated MNDP packets", () => {
  assertEquals(readTlvs(packet(0, 0, 0, 0, 0, 1, 0, 4, 1)), null);
});
