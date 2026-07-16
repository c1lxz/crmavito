import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/api") || pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  const modeMatch = pathname.match(/^\/(pc|m)(\/.*)?$/);
  if (modeMatch) {
    const mode = modeMatch[1] === "pc" ? "pc" : "m";
    const targetPath = modeMatch[2] || "/dashboard";
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-ui-mode", mode);

    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = targetPath;
    rewriteUrl.search = search;

    const response = NextResponse.rewrite(rewriteUrl, {
      request: { headers: requestHeaders },
    });
    response.cookies.set("crmavito-ui-mode", mode, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  }

  const rememberedMode = req.cookies.get("crmavito-ui-mode")?.value;
  if (
    (rememberedMode === "pc" || rememberedMode === "m") &&
    pathname !== "/" &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/v") &&
    !pathname.startsWith("/v-data")
  ) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = `/${rememberedMode}${pathname}`;
    return NextResponse.redirect(redirectUrl);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-ui-mode", "m");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
