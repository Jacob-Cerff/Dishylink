import { describe, expect, it } from "vitest";
import { sortByDisplayName } from "./accountSort";

describe("account list name ordering", () => {
  it("sorts names naturally and case-insensitively without mutating the source order", () => {
    const source = Object.freeze([
      { id: "c", name: "Site 10" },
      { id: "b", name: "site 2" },
      { id: "a", name: "ALPHA" },
    ]);
    expect(
      sortByDisplayName(
        source,
        (item) => item.name,
        (item) => item.id,
        "name-asc",
        "en",
      ).map((item) => item.id),
    ).toEqual(["a", "b", "c"]);
    expect(source.map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(
      sortByDisplayName(
        source,
        (item) => item.name,
        (item) => item.id,
        "name-desc",
        "en",
      ).map((item) => item.id),
    ).toEqual(["c", "b", "a"]);
  });
  it("uses identity as a stable tie-breaker for equal display names", () => {
    const source = [
      { id: "login-b", name: "Office" },
      { id: "login-a", name: "office" },
    ];
    expect(
      sortByDisplayName(
        source,
        (item) => item.name,
        (item) => item.id,
        "name-asc",
        "en",
      ).map((item) => item.id),
    ).toEqual(["login-a", "login-b"]);
    expect(
      sortByDisplayName(
        [...source].reverse(),
        (item) => item.name,
        (item) => item.id,
        "name-asc",
        "en",
      ).map((item) => item.id),
    ).toEqual(["login-a", "login-b"]);
  });
});
