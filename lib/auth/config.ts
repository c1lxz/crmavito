import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { validateTelegramInitData } from "./telegram";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [
    Credentials({
      id: "credentials",
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email, isActive: true },
        });
        if (!user || !user.passwordHash) return null;

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.name, email: user.email ?? "", role: user.role };
      },
    }),
    Credentials({
      id: "telegram",
      credentials: { initData: { type: "text" } },
      async authorize(credentials) {
        const initData = credentials?.initData as string | undefined;
        if (!initData) { console.error("[tg-auth] no initData"); return null; }

        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) { console.error("[tg-auth] TELEGRAM_BOT_TOKEN not set"); return null; }

        const tgUser = validateTelegramInitData(initData, botToken);
        if (!tgUser) { console.error("[tg-auth] validateTelegramInitData failed, initData prefix:", initData.slice(0, 80)); return null; }

        const telegramId = String(tgUser.id);
        console.log("[tg-auth] tgUser.id:", telegramId);
        const user = await prisma.user.findUnique({
          where: { telegramId, isActive: true },
        });
        if (!user) { console.error("[tg-auth] user not found for telegramId:", telegramId); return null; }

        const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ");
        if (fullName && user.name !== fullName) {
          await prisma.user.update({ where: { id: user.id }, data: { name: fullName } });
        }

        return { id: user.id, name: fullName || user.name, email: user.email ?? "", role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
};
