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

    const response = NextResponse.redirect(appPath(targetPath, search));
    response.cookies.set("crmavito-ui-mode", mode, {
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
