import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp, normalizeUrl, UnsafeUrlError } from "../src/services/urlSafety";

describe("normalizeUrl", () => {
  it("adds https:// when no scheme is given", () => {
    expect(normalizeUrl("example.com").toString()).toBe("https://example.com/");
  });

  it("preserves an explicit http/https scheme", () => {
    expect(normalizeUrl("http://example.com").protocol).toBe("http:");
    expect(normalizeUrl("https://example.com").protocol).toBe("https:");
  });

  it("rejects unsupported schemes", () => {
    expect(() => normalizeUrl("ftp://example.com")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow(UnsafeUrlError);
    expect(() => normalizeUrl("data:text/html,hi")).toThrow(UnsafeUrlError);
  });

  it("rejects URLs with embedded credentials", () => {
    expect(() => normalizeUrl("https://user:pass@example.com")).toThrow(UnsafeUrlError);
  });

  it("rejects malformed input", () => {
    expect(() => normalizeUrl("https://")).toThrow(UnsafeUrlError);
  });

  it("rejects empty input", () => {
    expect(() => normalizeUrl("   ")).toThrow(UnsafeUrlError);
  });
});

describe("isPrivateOrReservedIp", () => {
  it("flags loopback addresses", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
  });

  it("flags RFC1918 private ranges", () => {
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
  });

  it("does not flag adjacent-but-public 172.x ranges", () => {
    expect(isPrivateOrReservedIp("172.15.0.1")).toBe(false);
    expect(isPrivateOrReservedIp("172.32.0.1")).toBe(false);
  });

  it("flags link-local and cloud metadata addresses", () => {
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.1.1")).toBe(true);
  });

  it("flags CGNAT range", () => {
    expect(isPrivateOrReservedIp("100.64.0.1")).toBe(true);
  });

  it("flags 0.0.0.0 and multicast/reserved", () => {
    expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true);
    expect(isPrivateOrReservedIp("224.0.0.1")).toBe(true);
  });

  it("allows ordinary public IPv4 addresses", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
  });

  it("flags IPv6 loopback and unique-local/link-local ranges", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIp("fc00::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
  });

  it("allows ordinary public IPv6 addresses", () => {
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("treats non-IP strings as unsafe", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
  });
});
