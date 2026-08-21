import { describe, expect, it } from "vitest";
import { APP_ROLES, type AppRole } from "./domain";
import {
  CAPABILITIES,
  type Capability,
  PermissionError,
  assertCan,
  can,
  capabilitiesFor,
} from "./permissions";

describe("the role matrix", () => {
  it("covers every role in the schema", () => {
    for (const role of APP_ROLES) {
      expect(capabilitiesFor(role).length).toBeGreaterThan(0);
    }
  });

  it("gives the owner everything", () => {
    for (const capability of CAPABILITIES) {
      expect(can("owner", capability)).toBe(true);
    }
  });

  it("gives every role read access to the operational record", () => {
    for (const role of APP_ROLES) {
      expect(can(role, "shoot.read")).toBe(true);
      expect(can(role, "asset.read")).toBe(true);
    }
  });
});

describe("viewer", () => {
  // Every read EXCEPT sensitive_note.read, which is a privileged read and the
  // one place where the ".read" suffix does not imply general availability.
  it.each(
    CAPABILITIES.filter(
      (capability) => capability.endsWith(".read") && capability !== "sensitive_note.read",
    ),
  )("can %s", (capability) => {
    expect(can("viewer", capability as Capability)).toBe(true);
  });

  it("cannot read confidential source notes despite being a read capability", () => {
    expect(can("viewer", "sensitive_note.read")).toBe(false);
  });

  it("holds no capability that is not a read", () => {
    for (const capability of capabilitiesFor("viewer")) {
      expect(capability.endsWith(".read")).toBe(true);
    }
  });
});

describe("separation of duties", () => {
  it("keeps confidential source notes away from finance", () => {
    expect(can("finance", "sensitive_note.read")).toBe(false);
    expect(can("dispatcher", "sensitive_note.read")).toBe(false);
    expect(can("rights_reviewer", "sensitive_note.read")).toBe(false);
    expect(can("viewer", "sensitive_note.read")).toBe(false);
    expect(can("editor", "sensitive_note.read")).toBe(true);
    expect(can("owner", "sensitive_note.read")).toBe(true);
  });

  it("keeps money away from everyone but finance and the owner", () => {
    const allowed = APP_ROLES.filter((role) => can(role, "payment.write"));
    expect([...allowed].sort()).toEqual(["finance", "owner"]);
  });

  it("keeps sending away from everyone but dispatch and the owner", () => {
    const allowed = APP_ROLES.filter((role) => can(role, "submission.send"));
    expect([...allowed].sort()).toEqual(["dispatcher", "owner"]);
  });

  it("does not let a dispatcher rewrite a shoot brief", () => {
    expect(can("dispatcher", "shoot.write")).toBe(false);
  });

  it("does not let a rights reviewer clear a match by writing a license", () => {
    expect(can("rights_reviewer", "license.write")).toBe(false);
    expect(can("rights_reviewer", "rights.triage")).toBe(true);
  });

  it("restricts a bulk workspace export to owner and finance", () => {
    const exporters = APP_ROLES.filter((role: AppRole) => can(role, "export.workspace"));
    expect([...exporters].sort()).toEqual(["finance", "owner"]);
    // An editor can read a payment screen but cannot take the whole record.
    expect(can("editor", "payment.read")).toBe(true);
    expect(can("editor", "export.workspace")).toBe(false);
  });

  it("lets only the owner invite people or change workspace settings", () => {
    const inviters = APP_ROLES.filter((role: AppRole) => can(role, "member.invite"));
    expect(inviters).toEqual(["owner"]);
    const admins = APP_ROLES.filter((role: AppRole) => can(role, "workspace.settings"));
    expect(admins).toEqual(["owner"]);
  });
});

describe("assertCan", () => {
  it("passes when the role holds the capability", () => {
    expect(() => assertCan("finance", "payment.write")).not.toThrow();
  });

  it("throws a PermissionError naming the role and capability", () => {
    expect(() => assertCan("viewer", "payment.write")).toThrow(PermissionError);
    expect(() => assertCan("viewer", "payment.write")).toThrow(/viewer may not payment.write/);
  });
});
