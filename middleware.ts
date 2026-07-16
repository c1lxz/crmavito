import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function publicUrl(req: NextRequest, pathname: string, search = "") {
  const protocol = req.headers.get("x-forwarded-proto") || "https";
  const rawHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    .trim();
  const host = (rawHost || "crmavito.duckdns.org")
    .replace(/:\d+$/, "")
    .replace(/^localhost$/, "crmavito.duckdns.org");

  return new URL(`${pathname}${search}`, `${protocol}://${host}`);
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

    const response = NextResponse.redirect(publicUrl(req, targetPath, search));
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
    return NextResponse.redirect(publicUrl(req, `/${rememberedMode}${pathname}`, search));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
