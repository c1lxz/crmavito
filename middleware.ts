import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function appPath(pathname: string, search = "") {
  return `${pathname}${search}`;
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

    const response = NextResponse.redirect(new URL(appPath(targetPath, search), req.url));
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
