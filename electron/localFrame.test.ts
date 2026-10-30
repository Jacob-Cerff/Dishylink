import { describe, expect, it } from "vitest";
import { classifyLocalFrame } from "./localFrame";
function frame(field: number) {
  let tag = field * 8 + 2;
  const bytes: number[] = [];
  do {
    const low = tag % 128;
    tag = Math.floor(tag / 128);
    bytes.push(low + (tag ? 128 : 0));
  } while (tag);
  const message = new Uint8Array([...bytes, 0]);
  const result = new Uint8Array(message.length + 5);
  new DataView(result.buffer).setUint32(1, message.length);
  result.set(message, 5);
  return result;
}
describe("local LAN operation allowlist", () => {
  it("allows existing reads, requires a write binding for controls, and always refuses router ping", () => {
    expect(classifyLocalFrame(frame(1004), "router")).toBe("read");
    expect(classifyLocalFrame(frame(1008), "dish")).toBe("read");
    expect(classifyLocalFrame(frame(1001), "dish")).toBe("write");
    expect(classifyLocalFrame(frame(1009), "router")).toBeNull();
    expect(classifyLocalFrame(frame(9999), "dish")).toBeNull();
    expect(classifyLocalFrame(new Uint8Array([0, 0]), "dish")).toBeNull();
  });
});
