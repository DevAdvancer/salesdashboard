import {
  getChangedLockedLeadContactField,
  getLeadContactValuesToValidate,
  isLeadContactLocked,
  mergeLockedClientContactDetails,
} from "@/lib/utils/lead-contact-lock";

describe("lead contact fields", () => {
  it('skips unchanged contact values for partial or full-form ordinary edits', () => {
    const saved = { email: 'person@example.com', phone: '5551112222', field_16: 'https://linkedin.com/in/person' };
    expect(getLeadContactValuesToValidate(saved, { ...saved, notes: 'Called' })).toBeNull();
    expect(getLeadContactValuesToValidate(saved, {
      ...saved, email: ' person@example.com ', linkedinRequestId: 'new-request',
    })).toBeNull();
  });

  it.each(['linkedinProfileUrl', 'linkedinProfile', 'field_16', 'linkedinUrl'])(
    'checks a newly supplied %s under the canonical field', (field) => {
      const saved = { email: 'person@example.com', phone: '5551112222' };
      expect(getLeadContactValuesToValidate(saved, {
        ...saved, [field]: ' https://linkedin.com/in/person ',
      })).toEqual({ linkedinProfileUrl: 'https://linkedin.com/in/person' });
    },
  );

  it('checks every newly filled contact and does not treat request IDs as profiles', () => {
    expect(getLeadContactValuesToValidate({}, {
      email: 'person@example.com', phone: '5551112222', linkedinRequestId: 'request-1',
    })).toEqual({ email: 'person@example.com', phone: '5551112222' });
    expect(getLeadContactValuesToValidate({}, { phone: '   ', linkedinRequestId: 'request-1' })).toBeNull();
  });

  it("allows a missing value to be entered, then locks it after saving", () => {
    const saved = { email: "", phone: "   " };
    const next = { ...saved, email: "person@example.com", phone: "5551112222" };

    expect(isLeadContactLocked(saved, "email")).toBe(false);
    expect(getChangedLockedLeadContactField(saved, next)).toBeNull();
    expect(isLeadContactLocked(next, "email")).toBe(true);
    expect(getChangedLockedLeadContactField(next, { ...next, email: "other@example.com" }))
      .toBe("email");
  });

  it("locks a LinkedIn URL saved under a legacy alias", () => {
    const saved = { field_16: "https://linkedin.com/in/person" };
    expect(isLeadContactLocked(saved, "linkedinProfileUrl")).toBe(true);
    expect(getChangedLockedLeadContactField(saved, {
      ...saved,
      field_16: "https://linkedin.com/in/other",
    })).toBe("linkedinProfileUrl");
  });

  it("does not treat a LinkedIn request ID as a profile URL", () => {
    const saved = {
      linkedinProfileUrl: "https://linkedin.com/in/person",
      linkedinRequestId: "old-request",
    };
    expect(getChangedLockedLeadContactField(saved, {
      ...saved,
      linkedinRequestId: "new-request",
    })).toBeNull();
  });

  it("locks a configured LinkedIn URL alias on an older lead", () => {
    const saved = { linkedinUrl: "https://linkedin.com/in/person" };
    expect(isLeadContactLocked(saved, "linkedinProfileUrl")).toBe(true);
    expect(getChangedLockedLeadContactField(saved, {
      linkedinUrl: "https://linkedin.com/in/other",
    })).toBe("linkedinProfileUrl");
  });

  it("keeps saved lead contacts in client details and rejects replacements", () => {
    const lead = {
      email: "person@example.com",
      phone: "5551112222",
      linkedinProfileUrl: "https://linkedin.com/in/person",
    };
    expect(mergeLockedClientContactDetails(lead, {}, { notes: "Ready" })).toEqual({
      ...lead,
      notes: "Ready",
    });
    expect(() => mergeLockedClientContactDetails(lead, {}, {
      email: "other@example.com",
    })).toThrow("Email cannot be changed");
  });
});
