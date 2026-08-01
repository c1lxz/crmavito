import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WbResaleClient } from "@/components/wbr/wb-resale-client";
import { isWbPublicationOwner } from "@/lib/auth/wb-publication-owner";
import { prisma } from "@/lib/db/prisma";
import { INITIAL_PRIVATE_WB_PROFILE_NAMES } from "@/lib/wbr/private-publication-profiles";

export default async function WbResalePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [canViewPrivateProfiles, savedPrivateProfiles] = await Promise.all([
    isWbPublicationOwner(session.user),
    prisma.wbPrivatePublicationProfile.findMany({ select: { displayName: true } }),
  ]);

  return (
    <WbResaleClient
      canViewPrivateProfiles={canViewPrivateProfiles}
      privateProfileNames={[
        ...INITIAL_PRIVATE_WB_PROFILE_NAMES,
        ...savedPrivateProfiles.map((profile) => profile.displayName),
      ]}
    />
  );
}
