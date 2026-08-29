import { expect, test } from "@playwright/test";
import { at, refuseCookies, SEEDED_SHOOT, signIn } from "./helpers";

/**
 * Route tabs say where you are with aria-current="page", and the stylesheet
 * has to draw that state: the current package tab lost its visible treatment
 * once the dispatch page stopped adding a class of its own, while a component
 * test kept passing, because a component test cannot see a stylesheet.
 *
 * So this asserts the rendered result on a real dispatch page with more than
 * one package -- the seed puts two on the Hotel Chelsea shoot -- reading the
 * computed colour and the underline's opacity rather than a class name.
 */
test.describe("route tabs", () => {
  test.beforeEach(async ({ context }) => refuseCookies(context));

  test("the current package tab is marked once, and drawn as current", async ({ page }) => {
    await signIn(page);
    await page.goto(at(`/shoots/${SEEDED_SHOOT}`));
    // A package is only current once one is being reviewed.
    await page.goto(at(`/dispatch/${SEEDED_SHOOT}`));

    const tabs = page.getByRole("navigation", { name: "Packages on this shoot" });
    await expect(tabs).toBeVisible();
    const links = tabs.getByRole("link");
    expect(await links.count()).toBeGreaterThanOrEqual(2);

    // Exactly one current destination, told with aria-current and nothing else.
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabs.locator('[aria-selected], [role="tab"], [role="tablist"]')).toHaveCount(0);
    await expect(tabs).not.toHaveAttribute("role", /tab/);

    const drawn = await tabs.evaluate((nav) => {
      const read = (el: Element) => {
        const style = getComputedStyle(el);
        const underline = getComputedStyle(el, "::after");
        return {
          current: el.getAttribute("aria-current"),
          color: style.color,
          underlineOpacity: Number(underline.opacity),
          underlineHeight: underline.height,
        };
      };
      return Array.from(nav.querySelectorAll("a")).map(read);
    });

    const current = drawn.filter((tab) => tab.current === "page");
    const others = drawn.filter((tab) => tab.current === null);
    expect(current).toHaveLength(1);
    expect(others.length).toBeGreaterThanOrEqual(1);

    // Ink for the current tab and a visible underline; muted and no underline
    // for the rest. The colours are the sheet's --ml-ink and --ml-text-muted.
    expect(current[0].color).toBe("rgb(23, 23, 21)");
    expect(current[0].underlineOpacity).toBe(1);
    expect(current[0].underlineHeight).toBe("2px");
    for (const other of others) {
      expect(other.color).toBe("rgb(111, 107, 99)");
      expect(other.underlineOpacity).toBe(0);
    }

    // Following another tab moves the mark, and the URL names that package.
    const other = links.filter({ hasNot: page.locator('[aria-current="page"]') }).first();
    const otherName = (await other.innerText()).split("\n")[0].trim();
    await other.click();
    await page.waitForURL(/\/dispatch\/.*package=/);
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabs.locator('[aria-current="page"]')).toContainText(otherName);
  });
});
