import { describe, expect, it } from "vitest";
import { isAdmin, resolveAdminOptions } from "../src/admin";

describe("resolveAdminOptions", () => {
  it("defaults to the admin role and no user ids", () => {
    expect(resolveAdminOptions({})).toEqual({ adminRoles: ["admin"], adminUserIds: [] });
  });

  it("keeps what is passed", () => {
    expect(resolveAdminOptions({ adminRoles: ["owner"], adminUserIds: ["u1"] })).toEqual({
      adminRoles: ["owner"],
      adminUserIds: ["u1"],
    });
  });
});

describe("isAdmin", () => {
  const options = resolveAdminOptions({ adminRoles: ["admin", "support"], adminUserIds: ["boss"] });

  it("accepts listed user ids, whatever their role", () => {
    expect(isAdmin({ id: "boss" }, options)).toBe(true);
    expect(isAdmin({ id: "boss", role: "user" }, options)).toBe(true);
  });

  it("accepts any listed role among comma-separated roles", () => {
    expect(isAdmin({ id: "a", role: "admin" }, options)).toBe(true);
    expect(isAdmin({ id: "a", role: "user, support" }, options)).toBe(true);
    expect(isAdmin({ id: "a", role: "user,admin" }, options)).toBe(true);
  });

  it("rejects other roles, partial matches, and missing or non-string roles", () => {
    expect(isAdmin({ id: "a", role: "user" }, options)).toBe(false);
    expect(isAdmin({ id: "a", role: "superadmin" }, options)).toBe(false);
    expect(isAdmin({ id: "a", role: "admin2" }, options)).toBe(false);
    expect(isAdmin({ id: "a" }, options)).toBe(false);
    expect(isAdmin({ id: "a", role: ["admin"] }, options)).toBe(false);
    expect(isAdmin({ id: "a", role: null }, options)).toBe(false);
  });
});
