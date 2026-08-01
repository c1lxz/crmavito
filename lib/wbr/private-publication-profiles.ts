export const INITIAL_PRIVATE_WB_PROFILE_NAMES = ["Николай", "вбп", "c1lxz"] as const;

export function normalizeWbProfileName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru");
}

export function filterPrivateWbProfiles<T extends { name: string }>(
  profiles: T[],
  canViewPrivateProfiles: boolean,
  privateProfileNames: string[],
): T[] {
  if (canViewPrivateProfiles) return profiles;
  const privateNames = new Set(privateProfileNames.map(normalizeWbProfileName));
  return profiles.filter((profile) => !privateNames.has(normalizeWbProfileName(profile.name)));
}
