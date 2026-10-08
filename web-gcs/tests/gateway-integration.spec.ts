import { expect, test } from "@playwright/test";

test("前端接收真实 MAVLink 网关状态", async ({ page }) => {
  test.skip(process.env.MUVA_INTEGRATION !== "1", "仅在本地 SITL 与网关运行时执行");

  await page.goto("/");

  await expect(page.locator(".top-status.is-accent strong")).toHaveText("已连接", { timeout: 8_000 });
  await expect(page.getByLabel("飞控回传控制台")).toBeVisible();
  const modeSelect = page.getByLabel("飞行模式");
  await expect(modeSelect).not.toHaveValue("UNKNOWN");
  await expect(page.locator(".link-detail strong")).not.toHaveText("等待 MAVLink 网关");
  await expect(page.locator(".live-indicator")).toContainText("实时");

  // Exercise the real browser -> HTTP -> MAVLink -> heartbeat -> WebSocket path.
  await modeSelect.selectOption("GUIDED");
  await expect(page.getByText("切换 GUIDED · 飞控已接受")).toBeVisible({ timeout: 8_000 });
  await expect(modeSelect).toHaveValue("GUIDED");
  await expect(page.getByLabel("飞控回传控制台")).toContainText("mode=GUIDED", { timeout: 8_000 });

  await modeSelect.selectOption("LOITER");
  await expect(page.getByText("切换 LOITER · 飞控已接受")).toBeVisible({ timeout: 8_000 });
  await expect(modeSelect).toHaveValue("LOITER");

  await modeSelect.selectOption("AUTO");
  await expect(page.getByText("切换 AUTO · 飞控已接受")).toBeVisible({ timeout: 8_000 });
  await expect(modeSelect).toHaveValue("AUTO");
});
