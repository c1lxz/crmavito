import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_APP_URL = process.env.NEXTAUTH_URL || "https://crmavito.duckdns.org";

function appPath(pathname: string, search = "") {
  return new URL(`${pathname}${search}`, PUBLIC_APP_URL);
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith("/api") || pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  const modeMatch = pathname.match(/^\/(pc|m)(\/.*)?$/);
  if (modeMatch) {
    const mode = modeMatch[1] === "pc" ? "pc" : "m";
    const targetPath = modeMatch[2] || "/dashboard";
    const target = appPath(targetPath, search);
    target.searchParams.set("ui", mode);
    const response = NextResponse.redirect(target);
    response.cookies.set("crmavito-ui-mode", mode, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  }

  const queryMode = req.nextUrl.searchParams.get("ui");
  const forcedMode = queryMode === "m" || queryMode === "pc"
    ? queryMode
    : pathname === "/dashboard" ? "pc" : null;

  if (forcedMode) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-crmavito-ui-mode", forcedMode);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.set("crmavito-ui-mode", forcedMode, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
