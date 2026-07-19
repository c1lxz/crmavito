import { describe, expect, it } from "vitest";
import { avitoXmlPhoneForProfileName, normalizeAvitoXmlPhone } from "@/lib/avito/profile-store";

describe("Avito XML profile phones", () => {
  it("normalizes phones to Avito XML format", () => {
    expect(normalizeAvitoXmlPhone("79306840311")).toBe("+79306840311");
    expect(normalizeAvitoXmlPhone("+7 (999) 121-23-49")).toBe("+79991212349");
    expect(normalizeAvitoXmlPhone("+7 933 432-00-87")).toBe("+79334320087");
    expect(normalizeAvitoXmlPhone("8 908 238-71-03")).toBe("+79082387103");
  });

  it("maps saved Avito profile names to fixed XML phones", () => {
    expect(avitoXmlPhoneForProfileName("STROK SHOP")).toBe("+79306840311");
    expect(avitoXmlPhoneForProfileName("BY STROK SHOP")).toBe("+79334340391");
    expect(avitoXmlPhoneForProfileName("RE STROK SHOP")).toBe("+79991212349");
    expect(avitoXmlPhoneForProfileName("KY STROK SHOP")).toBe("+79334320087");
    expect(avitoXmlPhoneForProfileName("MU STROK SHOP")).toBe("+79082387103");
    expect(avitoXmlPhoneForProfileName("LE STROK SHOP")).toBe("+79334205210");
    expect(avitoXmlPhoneForProfileName("GU STROK SHOP")).toBe("+79960199751");
  });
});
