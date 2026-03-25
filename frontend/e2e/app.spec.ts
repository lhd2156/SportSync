import { test, expect } from "@playwright/test";

test.describe("Public Pages", () => {
  test("landing page loads with SportSync branding", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /SportSync logo SportSync/i }).first()).toBeVisible();
    await expect(page.locator("h1")).toContainText("The whole");
  });

  test("landing page has Get Started and Sign In buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Get Started" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Sign In" })).toHaveCount(1);
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1, button[type=submit]")).toBeVisible();
  });

  test("register page loads", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText("Create Account")).toBeVisible();
  });

  test("footer shows 18+ notice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("18 years of age")).toBeVisible();
  });

  test("cookie banner appears for new visitors", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SportSync uses cookies")).toBeVisible();
  });

  test("accepting cookies hides the banner", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Accept All").click();
    await expect(page.getByText("SportSync uses cookies")).not.toBeVisible();
  });
});

test.describe("Auth Guard", () => {
  test("dashboard redirects to login if not authenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard/);
  });

  test("settings redirects to login if not authenticated", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?redirect=%2Fsettings/);
  });
});
