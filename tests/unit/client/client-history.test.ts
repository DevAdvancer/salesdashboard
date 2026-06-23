import { isClientExcludedStatus, isVisibleClientLead } from "@/lib/utils/client-history";

describe("client history status helpers", () => {
  it("excludes Backed Out variants", () => {
    expect(isClientExcludedStatus("Backed Out")).toBe(true);
    expect(isClientExcludedStatus("backout")).toBe(true);
    expect(isClientExcludedStatus("Back out")).toBe(true);
  });

  it("excludes Not Interested variants", () => {
    expect(isClientExcludedStatus("Not Interested")).toBe(true);
    expect(isClientExcludedStatus("Not-Interested")).toBe(true);
    expect(isClientExcludedStatus("not interested")).toBe(true);
  });

  it("keeps other closed client statuses visible", () => {
    expect(
      isVisibleClientLead({ isClosed: true, status: "Signed/Closure" } as any),
    ).toBe(true);
    expect(
      isVisibleClientLead({ isClosed: true, status: "Won" } as any),
    ).toBe(true);
  });

  it("never shows non-closed leads on the client page", () => {
    expect(
      isVisibleClientLead({ isClosed: false, status: "Signed/Closure" } as any),
    ).toBe(false);
  });
});
