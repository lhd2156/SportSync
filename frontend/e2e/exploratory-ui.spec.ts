import { expect, test, type Page } from "@playwright/test";

function uniqueUser() {
  const stamp = Date.now();
  return {
    email: `sportsync.e2e.${stamp}@example.com`,
    password: "SportSyncE2E1",
    displayName: `tester_${stamp}`,
  };
}

async function acceptCookies(page: Page) {
  const accept = page.getByRole("button", { name: "Accept All" });
  if (await accept.isVisible().catch(() => false)) {
    await accept.click();
  }
}

async function collectClientErrors(page: Page, issues: string[]) {
  page.on("pageerror", (error) => {
    issues.push(`Uncaught page error: ${error.message}`);
  });

  page.on("console", (message) => {
    const text = message.text();
    const isExpectedUnauthorizedResourceError =
      text.includes("Failed to load resource") && text.includes("401");

    if (message.type() === "error" && !isExpectedUnauthorizedResourceError) {
      issues.push(`Console error: ${message.text()}`);
    }
  });
}

async function flagMojibake(page: Page, route: string, issues: string[]) {
  const text = await page.locator("body").innerText();
  const tokens = Array.from(
    new Set((text.match(/[Ââ][^\s]{0,8}/g) ?? []).slice(0, 8)),
  );

  if (tokens.length > 0) {
    issues.push(`${route} contains mojibake text: ${tokens.join(", ")}`);
  }
}

test.describe("Exploratory UI Sweep", () => {
  test("public pages, cookie controls, and invalid detail routes behave", async ({ page }) => {
    const issues: string[] = [];
    await collectClientErrors(page, issues);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SportSync" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage Preferences" })).toBeVisible();

    await page.getByRole("button", { name: "Manage Preferences" }).click();
    await expect(page.getByRole("heading", { name: "Cookie Preferences" })).toBeVisible();
    await page.getByRole("button", { name: "Save Preferences" }).click();
    await expect(page.getByText("SportSync uses cookies")).not.toBeVisible();

    for (const route of ["/terms", "/privacy", "/cookies", "/about"]) {
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();
      await flagMojibake(page, route, issues);
    }

    await page.goto("/games/not-a-real-game-id");
    await page.waitForURL("**/login");

    await page.goto("/teams/not-a-real-team-id");
    await page.waitForURL("**/login");

    expect(issues, issues.join("\n")).toEqual([]);
  });

  test("login shows a usable error for invalid credentials", async ({ page }) => {
    const issues: string[] = [];
    await collectClientErrors(page, issues);

    await page.goto("/login");
    await acceptCookies(page);

    await page.locator("#login-email").fill("nobody@example.com");
    await page.locator("#login-password").fill("wrong-password");
    const [loginResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/auth/login")),
      page.locator("form button[type='submit']").click(),
    ]);

    expect(loginResponse.status()).toBe(401);
    await expect(page.getByText(/Invalid email or password|Login failed/i)).toBeVisible();
    expect(issues, issues.join("\n")).toEqual([]);
  });

  test("registration, onboarding, protected routes, and session behavior work", async ({ page }) => {
    const issues: string[] = [];
    const user = uniqueUser();
    await collectClientErrors(page, issues);

    await page.goto("/register");
    await acceptCookies(page);

    await page.locator("#reg-first").fill("Playwright");
    await page.locator("#reg-last").fill("Tester");
    await page.locator("#reg-display").fill(user.displayName);
    await page.locator("#reg-email").fill(user.email);
    await page.locator("#reg-dob").fill("01/01/2012");
    await page.locator("#reg-pw").fill(user.password);
    await page.locator("#reg-cpw").fill(user.password);

    await expect(page.getByText("You must be 18 or older to use SportSync.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Account" })).toBeDisabled();

    await page.locator("#reg-dob").fill("01/01/1995");
    await page.locator("#reg-pw").fill("weak");
    await expect(page.getByRole("button", { name: "Create Account" })).toBeDisabled();

    await page.locator("#reg-pw").fill(user.password);
    await page.locator("#reg-cpw").fill("SportSyncE2E2");
    await expect(page.getByText("Passwords do not match")).toBeVisible();

    await page.locator("#reg-cpw").fill(user.password);
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.waitForURL("**/onboarding/step-2");

    const onboardingStep2Action = page.getByRole("button", { name: /Continue|Skip for now/i });
    await expect(onboardingStep2Action).toBeVisible({ timeout: 20000 });
    await onboardingStep2Action.click();
    await page.waitForURL("**/onboarding/step-3");

    const completeSetupAction = page.getByRole("button", { name: /Complete Setup|Skip for now/i });
    await expect(completeSetupAction).toBeVisible({ timeout: 20000 });
    await completeSetupAction.click();
    await page.waitForURL("**/dashboard");

    await expect(page.getByText("Settings")).toBeVisible();

    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    await page.getByRole("contentinfo").getByRole("link", { name: "Scores" }).click();
    await expect(page.getByRole("heading", { name: /Scores/i })).toBeVisible();

    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    await page.getByRole("contentinfo").getByRole("link", { name: "Teams" }).click();
    await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
    const firstSaveButton = page.getByRole("button", { name: /Save/ }).first();
    if ((await firstSaveButton.count()) === 0) {
      const mainText = await page.locator("main").innerText();
      if (!/No teams|Loading/i.test(mainText)) {
        issues.push("Teams page renders a blank state with filters only when no teams are available.");
      }
    } else {
      const firstSaveText = (await firstSaveButton.textContent()) ?? "";
      if (firstSaveText.includes("â") || firstSaveText.includes("Â")) {
        issues.push(`Teams page save button text is mojibake: "${firstSaveText.trim()}"`);
      }
    }

    await page.evaluate(() => {
      window.history.pushState({}, "", "/teams/not-a-real-team-id");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.waitForTimeout(2500);
    if (await page.locator(".animate-spin").count()) {
      issues.push("Invalid team detail route stays on a perpetual loading spinner instead of showing an error state.");
    }

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.locator("#s-name").fill(`${user.displayName}_updated`);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.goto("/dashboard");
    await page.reload();
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/login")) {
      issues.push("Authenticated session does not survive a full page reload on localhost.");
    }

    expect(issues, issues.join("\n")).toEqual([]);
  });
});
