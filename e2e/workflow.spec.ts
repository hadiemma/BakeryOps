import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("creates, edits, changes status, and persists an order", async ({ page }) => {
  await page.locator("#orders").getByRole("button", { name: /New order/ }).click();
  await page.getByLabel("Customer name").fill("Sunrise Cafe");
  await page.getByLabel("Due time").fill("09:45");
  await page.getByLabel("Quantity").fill("6");
  await page.getByRole("button", { name: "Add order" }).click();

  const row = page.getByRole("row").filter({ hasText: "Sunrise Cafe" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Customer name").fill("Sunrise Cafe Downtown");
  await page.getByRole("button", { name: "Save changes" }).click();

  const editedRow = page.getByRole("row").filter({ hasText: "Sunrise Cafe Downtown" });
  await expect(editedRow).toBeVisible();
  await editedRow.getByLabel("Status for Sunrise Cafe Downtown").selectOption("needsAttention");
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "Sunrise Cafe Downtown" })).toBeVisible();
  await expect(page.getByLabel("Status for Sunrise Cafe Downtown")).toHaveValue("needsAttention");
  await page.getByRole("button", { name: "Generate plan" }).click();
  const sourdoughBatch = page.locator(".batch-card").filter({ hasText: "Country sourdough" });
  await expect(sourdoughBatch).toContainText("Sunrise Cafe Downtown");
  await expect(sourdoughBatch).toContainText("Harbor Hotel");
  await expect(sourdoughBatch).toContainText("Mina Cafe");
  await expect(sourdoughBatch).not.toContainText("order-");
  await page.getByRole("button", { name: "Approve plan & create tasks" }).click();
  const sourdoughTask = page.locator(".task-card").filter({ hasText: "Prepare Country sourdough" });
  await expect(sourdoughTask).toContainText("Sunrise Cafe Downtown");
  await expect(sourdoughTask).toContainText("Harbor Hotel");
  await expect(sourdoughTask).not.toContainText("order-");
});

test("calculates, gates tasks on approval, and tracks assignments and blockers", async ({ page }) => {
  await expect(page.getByText("Tasks are locked")).toBeVisible();
  await page.getByRole("button", { name: "Generate plan" }).click();
  await expect(page.getByText("11,900 g").first()).toBeVisible();
  await expect(page.getByText("6,900 g").first()).toBeVisible();
  await expect(page.getByText("Tasks are locked")).toBeVisible();

  await page.getByRole("button", { name: "Request changes" }).click();
  await page.getByLabel("What should change?").fill("Schedule the croissants first");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Plan changes requested.")).toBeVisible();
  await expect(page.getByText("Tasks are locked")).toBeVisible();

  await page.getByRole("button", { name: "Regenerate plan" }).click();
  await expect(page.locator(".revision-label")).toContainText("Revision 2");
  await page.getByRole("button", { name: "Approve plan & create tasks" }).click();
  await expect(page.locator(".task-card")).toHaveCount(9);
  await expect(page.getByText("Approved by Alex Morgan", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Send back for changes" }).click();
  await page.getByLabel("What should change?").fill("Recheck the order quantities");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Plan changes requested.")).toBeVisible();
  await expect(page.getByText("Tasks are locked")).toBeVisible();
  await expect(page.locator(".task-card")).toHaveCount(0);
  await expect(page.locator(".approval-by")).toHaveCount(0);

  await page.getByRole("button", { name: "Regenerate plan" }).click();
  await expect(page.locator(".revision-label")).toContainText("Revision 3");
  await expect(page.getByText("Tasks are locked")).toBeVisible();
  await page.getByRole("button", { name: "Approve plan & create tasks" }).click();
  await expect(page.locator(".task-card")).toHaveCount(9);

  await page.getByLabel("Assignee for Prepare").first().selectOption("june");
  const prepareStatus = page.getByLabel("Progress for Prepare").first();
  await prepareStatus.selectOption("inProgress");
  await prepareStatus.selectOption("blocked");
  await page.getByLabel("Blocker note").first().fill("Oven is occupied");
  await page.getByRole("button", { name: "Mark blocked" }).first().click();
  await expect(page.getByText("Blocked: Oven is occupied")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Blocked: Oven is occupied")).toBeVisible();
  await expect(page.getByLabel("Assignee for Prepare").first()).toHaveValue("june");
  await expect(page.getByLabel("Status for Mina Cafe")).toHaveValue("needsAttention");

  const minaRow = page.getByRole("row").filter({ hasText: "Mina Cafe" });
  await minaRow.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Quantity").first().fill("16");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Orders changed — regenerate before approval")).toBeVisible();
  await expect(page.getByText("Tasks are locked")).toBeVisible();
  await expect(page.locator(".approved-banner")).toHaveCount(0);
  await expect(page.locator(".task-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Tasks are locked")).toBeVisible();
  await expect(page.getByLabel("Status for Mina Cafe")).toHaveValue("submitted");
});
