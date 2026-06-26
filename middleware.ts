import NextAuth from "next-auth";
import { edgeAuthConfig } from "@/lib/auth/edge-config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(edgeAuthConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api")) return NextResponse.next();
  if (pathname.startsWith("/login")) return NextResponse.next();

  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
