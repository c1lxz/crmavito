import { compare } from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

export async function authenticateWithPassword(login: string, password: string) {
  const normalizedLogin = login.trim().toLocaleLowerCase("ru");
  const user = await prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [
        { login: normalizedLogin },
        { email: { equals: normalizedLogin, mode: "insensitive" } },
      ],
    },
  });
  if (!user?.passwordHash) return null;
  if (!(await compare(password, user.passwordHash))) return null;
  return user;
}
