import { describe, expect, it } from "vitest";
import {
  INITIAL_PRIVATE_WB_PROFILE_NAMES,
  filterPrivateWbProfiles,
} from "@/lib/wbr/private-publication-profiles";

const profiles = [
  { id: "1", name: "Николай" },
  { id: "2", name: "ВБП" },
  { id: "3", name: "c1lxz" },
  { id: "4", name: "Профиль сотрудника" },
];

describe("private WB publication profiles", () => {
  it("shows every profile to the owner", () => {
    expect(filterPrivateWbProfiles(profiles, true, [...INITIAL_PRIVATE_WB_PROFILE_NAMES])).toEqual(profiles);
  });

  it("hides only the owner's profiles from other publishers", () => {
    expect(filterPrivateWbProfiles(profiles, false, [...INITIAL_PRIVATE_WB_PROFILE_NAMES])).toEqual([
      { id: "4", name: "Профиль сотрудника" },
    ]);
  });

  it("also hides profiles the owner creates later", () => {
    expect(filterPrivateWbProfiles(profiles, false, ["Профиль сотрудника"])).toEqual(profiles.slice(0, 3));
  });
});
