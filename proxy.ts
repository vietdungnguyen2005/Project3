import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/security-headers";

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    isDevelopment: process.env.NODE_ENV !== "production",
    nonce,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [{
    source: "/((?!_next/static|_next/image|favicon.ico).*)",
    missing: [
      { type: "header", key: "next-router-prefetch" },
      { type: "header", key: "purpose", value: "prefetch" },
    ],
  }],
};
