import { describe, expect, it } from "vitest";
import { WORKSPACE_SECTIONS, isProtected } from "./routes";
import { isPublicPath, workspaceRoutes, workspaceSlugFromPathname } from "./workspace-routes";

/**
 * The route builder.
 *
 * Two properties matter more than the exact strings: every destination begins
 * with the workspace address, and the dispatch review is addressed by SHOOT.
 * The second is the defect this module was written for -- the redirect after
 * building a package put the package id in the shoot's segment, which is a
 * path no route serves, so the screen the whole flow leads to answered 404.
 */
describe("workspaceRoutes", () => {
  const routes = workspaceRoutes("hale-studio");

  it("puts the workspace first in every destination", () => {
    const produced = [
      routes.root(),
      routes.work(),
      routes.commercial(),
      routes.opportunity("op-1"),
      routes.news(),
      routes.requests(),
      routes.newRequest(),
      routes.request("req-1"),
      routes.newsOpportunity("op-1"),
      routes.newNewsStory(),
      routes.shoots(),
      routes.newShoot(),
      routes.shoot("shoot-1"),
      routes.asset("asset-1"),
      routes.submissions(),
      routes.submission("sub-1"),
      routes.dispatch({ shootId: "shoot-1" }),
      routes.money(),
      routes.archive(),
      routes.rights(),
      routes.settings(),
      routes.billing(),
    ];

    for (const path of produced) {
      expect(path.startsWith("/hale-studio"), path).toBe(true);
      // A protocol-relative URL would leave the site; nothing here may produce one.
      expect(path.startsWith("//"), path).toBe(false);
      expect(path.includes("//"), path).toBe(false);
    }
  });

  it("builds the sections at the addresses the routes actually serve", () => {
    expect(routes.root()).toBe("/hale-studio");
    expect(routes.work()).toBe("/hale-studio/work");
    expect(routes.commercial()).toBe("/hale-studio/work/commercial");
    expect(routes.opportunity("julian-cross-soho")).toBe(
      "/hale-studio/work/commercial/julian-cross-soho",
    );
    expect(routes.requests()).toBe("/hale-studio/requests");
    expect(routes.newRequest()).toBe("/hale-studio/requests/new");
    expect(routes.request("abc")).toBe("/hale-studio/requests/abc");
    expect(routes.newShoot()).toBe("/hale-studio/shoots/new");
    expect(routes.newsOpportunity("op-1")).toBe("/hale-studio/news/op-1");
    expect(routes.newNewsStory()).toBe("/hale-studio/news/new");
    expect(routes.shoot("abc")).toBe("/hale-studio/shoots/abc");
    expect(routes.asset("def")).toBe("/hale-studio/assets/def");
    expect(routes.submission("ghi")).toBe("/hale-studio/submissions/ghi");
    expect(routes.money()).toBe("/hale-studio/money");
  });

  // The bug. /dispatch/<id> reads <id> as a SHOOT.
  describe("dispatch", () => {
    it("addresses the review by shoot and carries the package as a query", () => {
      expect(routes.dispatch({ shootId: "shoot-1", packageId: "pkg-1" })).toBe(
        "/hale-studio/dispatch/shoot-1?package=pkg-1",
      );
    });

    it("omits the query when no package was named", () => {
      expect(routes.dispatch({ shootId: "shoot-1" })).toBe("/hale-studio/dispatch/shoot-1");
    });

    /**
     * The whole point of the named argument: a package id cannot reach the
     * dynamic segment by being passed in the wrong position, because there is
     * no position to get wrong. This is the compile-time guarantee written out
     * as a runtime one.
     */
    it("never puts a package id in the path segment", () => {
      const path = routes.dispatch({ shootId: "shoot-1", packageId: "pkg-1" });
      expect(path.split("?")[0]).toBe("/hale-studio/dispatch/shoot-1");
      expect(path.split("?")[0]).not.toContain("pkg-1");
    });
  });

  it("preserves query parameters and drops empty ones", () => {
    expect(routes.archive({ query: { q: "chelsea", filter: "earning", page: 2 } })).toBe(
      "/hale-studio/archive?q=chelsea&filter=earning&page=2",
    );
    expect(routes.archive({ query: { q: "", filter: undefined, page: null } })).toBe(
      "/hale-studio/archive",
    );
    expect(routes.settings({ query: { saved: "address" } })).toBe(
      "/hale-studio/settings?saved=address",
    );
  });

  /**
   * The News Radar's two modes are URL-addressable, so a mode can be linked,
   * bookmarked, and restored. The mode rides in the query, never in the path.
   */
  it("addresses the news radar modes by query parameter", () => {
    expect(routes.news({ query: { mode: "archive" } })).toBe("/hale-studio/news?mode=archive");
    expect(routes.news({ query: { mode: "shoot" } })).toBe("/hale-studio/news?mode=shoot");
    expect(routes.news()).toBe("/hale-studio/news");
  });

  it("keeps a hash for an on-page anchor", () => {
    expect(routes.shoot("abc", { hash: "import" })).toBe("/hale-studio/shoots/abc#import");
  });

  it("encodes what a value could otherwise smuggle into the path", () => {
    expect(routes.asset("a b")).toBe("/hale-studio/assets/a%20b");
    // A slash inside an id is encoded rather than dropped, so it stays one
    // segment and cannot invent a route.
    expect(routes.asset("a/b")).toBe("/hale-studio/assets/a%2Fb");
    expect(routes.archive({ query: { q: "a&b=c" } })).toBe("/hale-studio/archive?q=a%26b%3Dc");
  });

  it("tolerates an address written with slashes around it", () => {
    expect(workspaceRoutes("/hale-studio/").work()).toBe("/hale-studio/work");
  });

  /**
   * An empty address is a programming error, not input to be repaired.
   * Returning "/work" for one would put the application straight back on the
   * cookie -- silently, which is exactly how the original bug survived.
   */
  it("refuses an address it cannot use", () => {
    expect(() => workspaceRoutes("")).toThrow(/Not a workspace address/);
    expect(() => workspaceRoutes("a/b")).toThrow(/Not a workspace address/);
  });

  /**
   * Every destination this builder produces has to be one the middleware
   * recognises as needing a session. A builder that could emit a path the gate
   * treats as public would be a hole, not a convenience.
   */
  it("produces only paths the gate treats as protected", () => {
    for (const path of [
      routes.work(),
      routes.shoots(),
      routes.shoot("x"),
      routes.asset("x"),
      routes.dispatch({ shootId: "x", packageId: "y" }),
      routes.submissions(),
      routes.money(),
      routes.archive(),
      routes.rights(),
      routes.news(),
      routes.requests(),
      routes.newRequest(),
      routes.request("abc"),
      routes.settings(),
      routes.billing(),
      routes.commercial(),
    ]) {
      expect(isProtected(path.split("?")[0]), path).toBe(true);
    }
  });

  it("covers every section the middleware calls a workspace path", () => {
    const produced = new Set(
      [
        routes.archive(),
        routes.asset("x"),
        routes.billing(),
        routes.dispatch({ shootId: "x" }),
        routes.money(),
        routes.news(),
        routes.requests(),
        routes.rights(),
        routes.settings(),
        routes.shoots(),
        routes.submissions(),
        routes.work(),
      ].map((path) => path.split("?")[0].split("/")[2]),
    );

    for (const section of WORKSPACE_SECTIONS) {
      expect(produced.has(section), `no builder produces /<workspace>/${section}`).toBe(true);
    }
  });
});

describe("workspaceSlugFromPathname", () => {
  it("reads the workspace out of a scoped path", () => {
    expect(workspaceSlugFromPathname("/hale-studio/work")).toBe("hale-studio");
    expect(workspaceSlugFromPathname("/hale-studio/shoots/abc")).toBe("hale-studio");
    expect(workspaceSlugFromPathname("/hale-studio/dispatch/abc?package=x")).toBe("hale-studio");
  });

  // A legacy path has no workspace in it, which is the whole reason it is legacy.
  it("returns nothing for a path that names no workspace", () => {
    expect(workspaceSlugFromPathname("/work")).toBe(null);
    expect(workspaceSlugFromPathname("/shoots/abc")).toBe(null);
    expect(workspaceSlugFromPathname("/sign-in")).toBe(null);
    expect(workspaceSlugFromPathname("/welcome")).toBe(null);
    expect(workspaceSlugFromPathname("/hale-studio")).toBe(null);
    expect(workspaceSlugFromPathname(null)).toBe(null);
    expect(workspaceSlugFromPathname("")).toBe(null);
  });
});

describe("isPublicPath", () => {
  it("recognises the surfaces that must never carry a workspace", () => {
    expect(isPublicPath("/d/abc123")).toBe(true);
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/sign-in/verify")).toBe(true);
    expect(isPublicPath("/auth/sign-out")).toBe(true);
    expect(isPublicPath("/api/webhooks/billing")).toBe(true);
    expect(isPublicPath("/onboarding")).toBe(true);
  });

  it("does not excuse an application path", () => {
    expect(isPublicPath("/work")).toBe(false);
    expect(isPublicPath("/shoots/abc")).toBe(false);
    expect(isPublicPath("/money")).toBe(false);
    expect(isPublicPath("/hale-studio/work")).toBe(false);
  });
});
