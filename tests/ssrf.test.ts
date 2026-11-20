import { describe, expect, it } from "vitest";
import {
  isPrivateOrReservedIp,
  safeFetchUrl,
  SsrfBlockedError,
  validatePublicHttpUrl,
} from "@/lib/ssrf";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("SSRF Protection", () => {
  it("identifies IPv4 and IPv6 private/reserved addresses", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.12.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("100.64.10.2")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd12:3456::1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:7f00:1")).toBe(true);

    expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks localhost, .internal, non-http protocols, embedded credentials, and DNS rebinding to RFC1918", async () => {
    await expect(validatePublicHttpUrl("http://localhost:3000", publicLookup)).rejects.toThrow(
      SsrfBlockedError
    );
    await expect(
      validatePublicHttpUrl("https://service.internal/health", publicLookup)
    ).rejects.toThrow(SsrfBlockedError);
    await expect(validatePublicHttpUrl("file:///etc/passwd", publicLookup)).rejects.toThrow(
      SsrfBlockedError
    );
    await expect(
      validatePublicHttpUrl("https://user:pass@example.com/", publicLookup)
    ).rejects.toThrow(SsrfBlockedError);
    await expect(
      validatePublicHttpUrl("http://169.254.169.254/latest/meta-data/", publicLookup)
    ).rejects.toThrow(SsrfBlockedError);
    await expect(
      validatePublicHttpUrl("https://rebind.attacker.test/", async () => [
        { address: "10.0.0.42", family: 4 },
      ])
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks redirect hops pointing to private hosts", async () => {
    const fetchMock = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:8080/internal-admin" },
      });

    await expect(
      safeFetchUrl("https://example.com/start", {
        lookupFn: publicLookup,
        fetchFn: fetchMock,
      })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("follows safe public redirects and enforces byte ceiling", async () => {
    const fetchMock = async (url: string) => {
      if (url === "https://example.com/") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.example.com/landing" },
        });
      }
      return new Response("<html><title>Test</title><body>" + "A".repeat(500) + "</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    const res = await safeFetchUrl("https://example.com/", {
      lookupFn: publicLookup,
      fetchFn: fetchMock,
      maxBytes: 120,
    });

    expect(res.finalUrl).toBe("https://www.example.com/landing");
    expect(res.redirectChain).toEqual([{ url: "https://example.com/", status: 301 }]);
    expect(res.byteLength).toBe(120);
    expect(res.truncated).toBe(true);
  });
});
