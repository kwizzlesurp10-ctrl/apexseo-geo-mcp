export const CANONICAL_BRAND = {
  author: "Keith S.",
  org: "kwizzlesurp.com · Sevtech · Dragon&PandaDuo",
  email: "kwizzlesurp10@gmail.com",
  website: "https://kwizzlesurp.com",
  location: "Minneapolis, MN, USA",
  repository: "https://github.com/kwizzlesurp10-ctrl/apexseo-geo-mcp",
} as const;

export const CANONICAL_PAY_TO = "0x0d25A44f74868eCE53B305C97139CF4B62963410";
export const BASE_MAINNET_NETWORK = "eip155:8453";
export const BASE_MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const DEFAULT_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

export const X402_TRUST_VERIFICATION =
  "x402-trust-verification=v1:MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAES7UjJ9XFU1xMwtXSfsSyOnBoTxMBdKTvypTHDwxiWeIzJ5k3JLtJRDtBo435MFhItcelm_1GFzzsF3ltaL6tjA";

export interface PaymentConfig {
  payTo: `0x${string}`;
  network: typeof BASE_MAINNET_NETWORK;
  usdcAsset: typeof BASE_MAINNET_USDC;
  facilitatorUrl: string;
  cdpApiKeyId: string | null;
  cdpApiKeySecret: string | null;
  hasCdpAuth: boolean;
  publicBaseUrl: string;
  demoMode: boolean;
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function normalizeUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

export function resolvePublicBaseUrl(requestOrigin?: string): string {
  const configured =
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    requestOrigin?.trim();

  if (configured) {
    return normalizeUrl(configured);
  }
  return "http://localhost:3000";
}

export function isDemoMode(publicBaseUrl: string): boolean {
  if (process.env.DEMO_ALLOW_PUBLIC === "true") {
    return true;
  }
  return publicBaseUrl.startsWith("http://");
}

export function getPaymentConfig(requestOrigin?: string): PaymentConfig {
  const rawPayTo = process.env.X402_PAY_TO?.trim() || CANONICAL_PAY_TO;
  if (!ETH_ADDRESS_RE.test(rawPayTo)) {
    throw new Error(`Invalid X402_PAY_TO EVM address configured: ${rawPayTo}`);
  }

  const publicBaseUrl = resolvePublicBaseUrl(requestOrigin);
  const cdpApiKeyId = process.env.CDP_API_KEY_ID?.trim() || null;
  const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET?.trim() || null;

  return {
    payTo: rawPayTo as `0x${string}`,
    network: BASE_MAINNET_NETWORK,
    usdcAsset: BASE_MAINNET_USDC,
    facilitatorUrl:
      process.env.X402_FACILITATOR_URL?.trim().replace(/\/+$/, "") ||
      DEFAULT_FACILITATOR_URL,
    cdpApiKeyId,
    cdpApiKeySecret,
    hasCdpAuth: Boolean(cdpApiKeyId && cdpApiKeySecret),
    publicBaseUrl,
    demoMode: isDemoMode(publicBaseUrl),
  };
}
