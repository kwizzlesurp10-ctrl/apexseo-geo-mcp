import crypto from "node:crypto";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function buildKeyObject(rawSecret: string): {
  alg: "ES256" | "EdDSA";
  key: crypto.KeyObject;
} {
  const normalized = rawSecret.replace(/\\n/g, "\n").trim();

  if (normalized.includes("BEGIN EC PRIVATE KEY") || normalized.includes("BEGIN PRIVATE KEY")) {
    const key = crypto.createPrivateKey(normalized);
    const keyType = key.asymmetricKeyType;
    if (keyType === "ed25519") {
      return { alg: "EdDSA", key };
    }
    return { alg: "ES256", key };
  }

  // Coinbase CDP Ed25519 keys are base64-encoded 64-byte (seed + pubkey) or 32-byte seeds
  const rawBytes = Buffer.from(normalized, "base64");
  if (rawBytes.length !== 64 && rawBytes.length !== 32) {
    throw new Error(
      `Unsupported CDP_API_KEY_SECRET format (expected PEM EC/Ed25519 or 32/64-byte base64 key, got ${rawBytes.length} bytes)`
    );
  }
  const seed = rawBytes.subarray(0, 32);
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return { alg: "EdDSA", key };
}

/**
 * Generates a short-lived Coinbase CDP v2 Bearer JWT scoped to a specific HTTP request URI.
 */
export function signCdpJwt(params: {
  keyId: string;
  keySecret: string;
  requestMethod: string;
  requestUrl: string;
}): string {
  const { keyId, keySecret, requestMethod, requestUrl } = params;
  const parsed = new URL(requestUrl);
  const { alg, key } = buildKeyObject(keySecret);
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString("hex");

  const header = {
    alg,
    typ: "JWT",
    kid: keyId,
    nonce,
  };

  const payload = {
    sub: keyId,
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    uris: [`${requestMethod.toUpperCase()} ${parsed.host}${parsed.pathname}`],
  };

  const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;

  let signature: Buffer;
  if (alg === "ES256") {
    signature = crypto.sign("sha256", Buffer.from(signingInput, "utf8"), {
      key,
      dsaEncoding: "ieee-p1363",
    });
  } else {
    signature = crypto.sign(null, Buffer.from(signingInput, "utf8"), key);
  }

  return `${signingInput}.${toBase64Url(signature)}`;
}
