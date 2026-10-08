import { expect, test } from "@playwright/test";

test("核心控制与任务交互可用", async ({ page }) => {
  await page.goto("/?demo=1");

  await expect(page.getByRole("heading", { name: "飞行遥测" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "飞行控制" })).toBeVisible();
  await expect(page.getByLabel("飞控回传控制台")).toBeVisible();

  await page.getByLabel("飞行模式").selectOption("GUIDED");
  await expect(page.getByText("切换 GUIDED · 等待飞控确认")).toBeVisible();
  await expect(page.getByLabel("飞行模式")).toHaveValue("GUIDED", { timeout: 2_000 });

  await page.getByRole("button", { name: "锁定飞行器" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "确认锁定" }).click();
  await expect(page.getByText("SAFE")).toBeVisible({ timeout: 2_000 });

  await page.getByRole("button", { name: "规划", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务规划" })).toBeVisible();
  await expect(page.getByLabel("规划工具")).toBeVisible();
  await expect(page.getByLabel("飞控回传控制台")).toBeVisible();
  await expect(page.getByText("只读 · UDP 14553")).toBeVisible();
  await expect(page.getByText("COMMAND_ACK")).toBeVisible();

  await page.getByRole("button", { name: "连续添加航点" }).click();
  await expect(page.getByText("选点中")).toBeVisible();
  await page.locator(".map-canvas").click({ position: { x: 360, y: 260 } });
  await expect(page.getByRole("form", { name: "航点属性" })).toBeVisible();
  await expect(page.locator(".mission-row")).toHaveCount(3);
  await page.locator(".map-canvas").click({ position: { x: 455, y: 335 } });
  await expect(page.locator(".mission-row")).toHaveCount(4);
  await page.locator(".map-canvas").click({ position: { x: 520, y: 300 } });
  await expect(page.locator(".mission-row")).toHaveCount(5);

  await page.getByLabel("任务类型").selectOption("LOITER_TIME");
  await page.getByLabel("任务项名称").fill("悬停检查点");
  await page.getByLabel("悬停时间").fill("45");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("悬停检查点")).toBeVisible();
  await expect(page.locator(".mission-map-marker.is-selected")).toHaveCount(1);

  await page.locator(".mission-row").nth(3).dragTo(page.locator(".mission-row").nth(1));
  await expect(page.getByText("任务顺序已更新，请重新上传并校验")).toBeVisible();

  await page.getByRole("button", { name: "生成区域测绘航线" }).click();
  await expect(page.getByText("测绘航点 1")).toBeVisible();
  await expect(page.locator(".mission-row")).toHaveCount(6);

  await page.getByRole("button", { name: "系统" }).click();
  await expect(page.getByRole("heading", { name: "系统状态" })).toBeVisible();
  await expect(page.getByText("起飞检查通过")).toBeVisible();
});
