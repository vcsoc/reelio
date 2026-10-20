import { test, expect, type Page } from "@playwright/test";
async function desktopMock(page: Page, os = "linux", tiling = false) {
  await page.addInitScript(
    ({ os, tiling }) => {
      let sequence = 0;
      const callbacks = new Map<number, any>(),
        events = new Map<string, number>();
      Object.assign(window, {
        isTauri: true,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        emitCloseRequest: () =>
          callbacks.get(events.get("app:close-requested")!)?.({
            event: "app:close-requested",
            payload: null,
            id: 1,
          }),
      });
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          transformCallback: (fn: any) => {
            callbacks.set(++sequence, fn);
            return sequence;
          },
          unregisterCallback: (id: number) => callbacks.delete(id),
          invoke: async (cmd: string, args: any = {}) => {
            if (cmd === "plugin:event|listen") {
              events.set(args.event, args.handler);
              return ++sequence;
            }
            if (cmd === "window_platform") return { os, tiling };
            if (cmd === "window_action") {
              if (args.action !== "state") {
                const actions = JSON.parse(
                  localStorage.getItem("window-actions") || "[]",
                );
                actions.push(args.action);
                localStorage.setItem("window-actions", JSON.stringify(actions));
              }
              return false;
            }
            if (cmd === "dependencies_status")
              return {
                preview_available: true,
                network_available: true,
                backend_available: true,
                missing_components: [],
                packages: [],
                repair_supported: false,
                repair_hint: "",
              };
            if (cmd === "settings_get")
              return {
                theme: "dark",
                recents: [],
                backend: null,
                default_folder: "/tmp",
                image_format: "png",
              };
            if (cmd === "backend_status")
              return {
                ffmpeg_version: "test",
                ffprobe_version: "test",
                muxers: [],
                subtitle_encoders: [],
              };
            if (cmd === "jobs_list") return [];
            if (cmd === "subtitle_editor_draft") {
              if (args.clear) localStorage.removeItem("saved-subtitle-draft");
              if (args.document)
                localStorage.setItem(
                  "saved-subtitle-draft",
                  JSON.stringify(args.document),
                );
              return JSON.parse(
                localStorage.getItem("saved-subtitle-draft") || "null",
              );
            }
            if (cmd === "subtitle_model_status")
              return { id: "", status: "idle", done: 0, total: 0, message: "" };
            if (cmd === "subtitle_models") return [];
            if (cmd === "project_save") return "/tmp/toast-project.reelio";
            return null;
          },
        },
      });
    },
    { os, tiling },
  );
  await page.goto("/");
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toBeVisible();
}
test("save feedback is a floating auto-hiding toast, paused while reading", async ({
  page,
}) => {
  await page.clock.install();
  await desktopMock(page);
  await page.getByRole("button", { name: "Project menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Save project", exact: true })
    .click();
  const toast = page
    .locator(".toast")
    .filter({ hasText: "Project saved: toast-project.reelio" });
  await expect(toast).toBeVisible();
  expect(
    await toast.evaluate((e) => getComputedStyle(e.parentElement!).position),
  ).toBe("fixed");
  await toast.hover();
  await page.clock.fastForward(9000);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(4000);
  await page.getByRole("tab", { name: "Metadata", exact: true }).click();
  await page.clock.fastForward(1100);
  await expect(toast).toHaveCount(0);
});
for (const platform of [
  { os: "linux", tiling: true },
  { os: "linux", tiling: false },
  { os: "macos", tiling: false },
]) {
  test(`${platform.os} tiling=${platform.tiling} window controls match the platform`, async ({
    page,
  }) => {
    await desktopMock(page, platform.os, platform.tiling);
    const controls = page.getByRole("group", {
      name: "Window controls",
      exact: true,
    });
    if (platform.tiling) {
      await expect(controls).toHaveCount(0);
      return;
    }
    await expect(controls).toHaveAttribute("data-platform", platform.os);
    if (platform.os === "macos") {
      const group = (await controls.boundingBox())!,
        brand = (await page
          .getByRole("link", { name: "Reelio home" })
          .boundingBox())!;
      expect(group.x).toBeLessThan(brand.x);
      const close = (await controls
          .getByRole("button", { name: "Close window" })
          .boundingBox())!,
        min = (await controls
          .getByRole("button", { name: "Minimize window" })
          .boundingBox())!;
      expect(close.x).toBeLessThan(min.x);
    }
  });
}
test("Quit and Ctrl+W work on Omarchy; OS close keeps a confirmed subtitle recovery draft without redirecting", async ({
  page,
}) => {
  await desktopMock(page, "linux", true);
  await page.getByRole("button", { name: "Project menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Quit Reelio", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("window-actions") || "[]"),
      ),
    )
    .toContain("confirm_close");
  await page.evaluate(() => localStorage.removeItem("window-actions"));
  await page.keyboard.press("Control+w");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("window-actions") || "[]"),
      ),
    )
    .toContain("confirm_close");
  await page.evaluate(() => localStorage.removeItem("window-actions"));
  await page.getByRole("tab", { name: "Subtitle Studio", exact: true }).click();
  await page.getByRole("button", { name: "New SRT", exact: true }).click();
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Control+w");
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await page.evaluate(() => localStorage.getItem("window-actions")),
  ).toBeNull();
  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => (window as any).emitCloseRequest());
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("saved-subtitle-draft")),
    )
    .not.toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("window-actions") || "[]"),
      ),
    )
    .toContain("confirm_close");
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
