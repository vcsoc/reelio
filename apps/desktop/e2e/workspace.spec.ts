import { expect, test, type Page } from "@playwright/test";
async function openProjectMenu(page: Page) {
  const trigger = page.getByRole("button", {
    name: "Project menu",
    exact: true,
  });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
}
async function selectProjectAction(page: Page, name: string) {
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name, exact: true }).click();
}
import { readFileSync } from "node:fs";
const coverJpeg = readFileSync(
  new URL("./fixtures/poster.jpg", import.meta.url),
).toString("base64");
const previewVideo = `data:video/webm;base64,${readFileSync(new URL("./fixtures/preview.webm", import.meta.url)).toString("base64")}`;
test("media pool resize persists across reload without changing project state", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Narrow layouts stack panels rather than showing the divider",
  );
  await page.goto("/");
  const divider = page.getByRole("separator", { name: "Resize media pool" });
  await expect(divider).toHaveAttribute("aria-valuenow", "280");
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "290");
  await page.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", "290");
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(
    0,
  );
  await divider.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "280");
  const inspector = page.getByRole("separator", {
    name: "Resize right inspector",
  });
  await expect(inspector).toHaveAttribute("aria-valuenow", "440");
  await inspector.focus();
  await inspector.press("ArrowLeft");
  await expect(inspector).toHaveAttribute("aria-valuenow", "450");
  await page.reload();
  await expect(inspector).toHaveAttribute("aria-valuenow", "450");
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(
    0,
  );
  const rect = (await inspector.boundingBox())!;
  await page.mouse.move(rect.x + 4, rect.y + 80);
  await page.mouse.down();
  await page.mouse.move(rect.x - 36, rect.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => inspector.getAttribute("aria-valuenow").then(Number))
    .toBeGreaterThan(450);
});
test("workspace layout preferences persist and artwork uses the lower workspace", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const root = page.getByRole("main", { name: "Editor workspace" });
  const sidebar = page.getByRole("complementary", { name: "Media sidebar" });
  const inspector = page.getByRole("complementary", {
    name: "Right inspector",
  });
  const lower = page.getByRole("region", { name: "Lower workspace" });
  const viewer = page.getByRole("region", { name: "Video viewer" });
  await expect(root).toHaveAttribute("data-pool-height", "upper");
  if (testInfo.project.name === "desktop") {
    const poolDivider = page.getByRole("separator", {
      name: "Resize media pool",
    });
    await poolDivider.focus();
    await poolDivider.press("ArrowRight");
    const inspectorDivider = page.getByRole("separator", {
      name: "Resize right inspector",
    });
    await inspectorDivider.focus();
    await inspectorDivider.press("ArrowLeft");
  }
  const initialViewer = (await viewer.boundingBox())!;
  const initialLower = (await lower.boundingBox())!;
  const heightToggle = page.getByRole("button", {
    name: "Make left panel full height",
    exact: true,
  });
  await expect(heightToggle).toHaveAttribute(
    "title",
    "Make left panel full height",
  );
  await heightToggle.click();
  await expect(root).toHaveAttribute("data-pool-height", "full");
  await expect(
    page.getByRole("button", { name: "Keep left panel above timelines" }),
  ).toHaveAttribute("aria-pressed", "true");
  if (testInfo.project.name === "desktop") {
    const leftBox = (await sidebar.boundingBox())!;
    const lowerBox = (await lower.boundingBox())!;
    const inspectorBox = (await inspector.boundingBox())!;
    const leftButton = (await page
      .getByRole("button", { name: "Collapse left sidebar" })
      .boundingBox())!;
    const rightButton = (await page
      .getByRole("button", { name: "Collapse right sidebar" })
      .boundingBox())!;
    expect(leftButton.x + leftButton.width).toBeLessThanOrEqual(
      leftBox.x + leftBox.width + 1,
    );
    expect(leftButton.x + leftButton.width).toBeGreaterThan(
      leftBox.x + leftBox.width - 10,
    );
    expect(rightButton.x).toBeGreaterThanOrEqual(inspectorBox.x);
    expect(rightButton.x).toBeLessThan(inspectorBox.x + 15);
    expect(lowerBox.x).toBeGreaterThan(initialLower.x + 100);
    expect(lowerBox.x).toBeGreaterThanOrEqual(leftBox.x + leftBox.width - 1);
    expect(
      Math.abs(leftBox.y + leftBox.height - lowerBox.y - lowerBox.height),
    ).toBeLessThan(2);
    await page.screenshot({
      path: testInfo.outputPath("full-height-left-panel.png"),
      fullPage: true,
    });
  }
  const collapseLeft = page.getByRole("button", {
    name: "Collapse left sidebar",
  });
  await expect(collapseLeft).toHaveAttribute("title", "Collapse left sidebar");
  await collapseLeft.focus();
  await collapseLeft.press("Enter");
  await expect(sidebar).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Expand left sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Collapse right sidebar" }).click();
  await expect(inspector).toBeHidden();
  if (testInfo.project.name === "desktop") {
    await expect(
      page.getByRole("separator", { name: "Resize media pool" }),
    ).toBeHidden();
    await expect(
      page.getByRole("separator", { name: "Resize right inspector" }),
    ).toBeHidden();
    expect((await viewer.boundingBox())!.width).toBeGreaterThan(
      initialViewer.width + 500,
    );
  }
  await page.reload();
  await expect(root).toHaveAttribute("data-pool-height", "full");
  await expect(sidebar).toBeHidden();
  await expect(inspector).toBeHidden();
  await page.getByRole("button", { name: "Expand left sidebar" }).click();
  await page.getByRole("button", { name: "Expand right sidebar" }).click();
  await expect(sidebar).toBeVisible();
  await expect(inspector).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await expect(
      page.getByRole("separator", { name: "Resize media pool" }),
    ).toHaveAttribute("aria-valuenow", "290");
    await expect(
      page.getByRole("separator", { name: "Resize right inspector" }),
    ).toHaveAttribute("aria-valuenow", "450");
  }
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Keep left panel above timelines" })
    .click();
  await page.reload();
  await expect(root).toHaveAttribute("data-pool-height", "upper");
  await page.getByRole("tab", { name: "Poster & cover" }).click();
  await expect(
    lower.getByRole("heading", { name: "Poster & cover studio" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Timeline editor" }),
  ).toBeHidden();
  if (testInfo.project.name === "mobile")
    await expect
      .poll(
        async () =>
          (await lower
            .getByRole("heading", { name: "Poster & cover studio" })
            .boundingBox())!.y,
      )
      .toBeGreaterThanOrEqual(44);
  await expect(inspector.locator(".artwork-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse right sidebar" }).click();
  await expect(
    lower.getByRole("heading", { name: "Poster & cover studio" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("lower-artwork-workspace.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Timeline editor" }),
  ).toBeVisible();
});
test("layout controls remain usable when preference storage is blocked", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Make left panel full height" })
    .click();
  await page.getByRole("button", { name: "Collapse left sidebar" }).click();
  await page.getByRole("button", { name: "Collapse right sidebar" }).click();
  await page.getByRole("button", { name: "Expand left sidebar" }).click();
  await page.getByRole("button", { name: "Expand right sidebar" }).click();
  await expect(
    page.getByRole("main", { name: "Editor workspace" }),
  ).toHaveAttribute("data-pool-height", "full");
  await expect(
    page.getByRole("heading", { name: "No media in this project" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("project menu, toolbar tools, borderless title and interface zoom", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Export & history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "MP4", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Output profile", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  const trigger = page.getByRole("button", {
    name: "Project menu",
    exact: true,
  });
  const tools = page.getByRole("navigation", {
    name: "Project tools",
    exact: true,
  });
  await expect(tools.getByRole("tab")).toHaveCount(9);
  await expect(
    page.getByRole("complementary", { name: "Media sidebar" }).getByRole("tab"),
  ).toHaveCount(0);
  await expect(tools.getByRole("tablist")).toHaveAttribute(
    "aria-orientation",
    "horizontal",
  );
  await tools.getByRole("tab", { name: "Timeline", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tools.getByRole("tab", { name: "Media information", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const burger = (await trigger.boundingBox())!;
  const collapse = (await page
    .getByRole("button", { name: "Collapse left sidebar" })
    .boundingBox())!;
  expect(burger.x + burger.width).toBeLessThanOrEqual(collapse.x);
  await trigger.focus();
  await trigger.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Project actions" });
  await expect(menu.getByRole("menuitem")).toHaveCount(7);
  await expect(
    menu.getByRole("menuitem", { name: "Add tracks", exact: true }),
  ).toHaveCount(0);
  await expect(
    menu.getByRole("menuitem", { name: "New project", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "About Reelio", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "New project", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "About Reelio", exact: true })
    .click();
  const about = page.getByRole("dialog", { name: "About Reelio", exact: true });
  await expect(about).toBeVisible();
  await expect(
    about.getByText("Developed by Chris Visser", { exact: true }),
  ).toBeVisible();
  await expect(
    about.getByText("Version Browser preview", { exact: true }),
  ).toBeVisible();
  await expect(about.getByRole("link")).toHaveAttribute(
    "href",
    "https://github.com/vcsoc/reelio",
  );
  await page.screenshot({ path: testInfo.outputPath("about-reelio.png") });
  await page.keyboard.press("Escape");
  await expect(about).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Collapse left sidebar" }),
  ).toBeFocused();
  await trigger.click();
  await page.getByRole("button", { name: "Collapse left sidebar" }).click();
  await expect(menu).toBeHidden();
  await expect(tools).toBeVisible();
  await tools.getByRole("tab", { name: "Poster & cover", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Poster & cover studio" }),
  ).toBeVisible();
  const movieTitle = page.getByRole("textbox", {
    name: "Movie title",
    exact: true,
  });
  await movieTitle.focus();
  for (const theme of ["dark", "light"]) {
    const colors = await movieTitle.evaluate((input, theme) => {
      document.documentElement.dataset.theme = theme;
      const style = getComputedStyle(input, "::selection");
      return [style.backgroundColor, style.color];
    }, theme);
    expect(colors).toEqual(["rgb(49, 95, 196)", "rgb(255, 255, 255)"]);
  }
  await page.locator("html").evaluate((html) => {
    html.dataset.theme = "dark";
  });
  await tools.getByRole("tab", { name: "Timeline", exact: true }).click();
  const title = page.getByRole("textbox", {
    name: "Project name",
    exact: true,
  });
  await expect(title).toHaveCSS("border-top-width", "0px");
  await expect(title).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await title.focus();
  await expect(title).toHaveCSS("outline-style", "solid");
  const projectTitle = await title.inputValue();
  for (const theme of ["dark", "light"]) {
    await page.locator("html").evaluate((html, theme) => {
      html.dataset.theme = theme;
    }, theme);
    await title.focus();
    await page.keyboard.press("Control+a");
    expect(
      await title.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    ).toEqual([0, projectTitle.length]);
    expect(
      await title.evaluate((input) => {
        const selection = getComputedStyle(input, "::selection");
        return [selection.backgroundColor, selection.color];
      }),
    ).toEqual(["rgb(49, 95, 196)", "rgb(255, 255, 255)"]);
    await title.screenshot({
      path: testInfo.outputPath(`project-title-selected-${theme}.png`),
    });
    await page.keyboard.press("ArrowRight");
    expect(
      await title.evaluate(
        (input: HTMLInputElement) =>
          input.selectionStart === input.selectionEnd,
      ),
    ).toBe(true);
    expect(
      await title.evaluate((input) => {
        const style = getComputedStyle(input);
        return style.caretColor === style.color;
      }),
    ).toBe(true);
    await page.keyboard.press("Shift+ArrowLeft");
    expect(
      await title.evaluate(
        (input: HTMLInputElement) =>
          input.selectionEnd! - input.selectionStart!,
      ),
    ).toBe(1);
    await expect(title).toHaveValue(projectTitle);
    await expect(title).toHaveCSS("border-top-width", "0px");
  }
  await page.locator("html").evaluate((html) => {
    html.dataset.theme = "dark";
  });
  await page.keyboard.press("Control+=");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "110",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "110",
  );
  await page.keyboard.press("Control+-");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "100",
  );
  await page.keyboard.press("Control+Shift+=");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "110",
  );
  await page.keyboard.press("Control+0");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "100",
  );
  for (let count = 0; count < 15; count++)
    await page.keyboard.press("Control+=");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "200",
  );
  for (let count = 0; count < 20; count++)
    await page.keyboard.press("Control+-");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "50",
  );
  await page.keyboard.press("Control+0");
  await page.keyboard.press("Meta+=");
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "110",
  );
  await page
    .getByRole("button", {
      name: "Interface zoom 110%, reset to 100%",
      exact: true,
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-interface-zoom",
    "100",
  );
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("toolbar-project-tools.png"),
    fullPage: true,
  });
});
test("browser preview clearly identifies its boundary and remains responsive", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "No media in this project" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(24, 25, 27)",
  );
  await expect(page.locator(".sidebar")).toHaveCSS(
    "background-color",
    "rgb(32, 33, 35)",
  );
  expect(
    await page
      .locator(".toolbar")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(testInfo.project.name === "mobile" ? 80 : 40);
  await page.screenshot({
    path: testInfo.outputPath("pigeon-dark-empty.png"),
    fullPage: true,
  });
  await expect(
    page.getByText("Browser preview only.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open media files", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open media files", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Open Reelio as a desktop application",
  );
});
test("workspace editing flow with a mocked Tauri IPC boundary", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.addInitScript(
    ({ coverJpeg, previewVideo }) => {
      Object.defineProperty(window, "isTauri", { value: true });
      const callbacks = new Map<number, unknown>();
      let sequence = 0;
      const asset = {
        id: "a1",
        path: "/media/Film.mkv",
        size: 123000000,
        modified_ms: 1,
        format: "matroska",
        duration_ms: 120000,
        metadata: { title: "Film" },
        chapters: [],
        streams: [
          {
            index: 0,
            kind: "video",
            codec: "h264",
            title: "Picture",
            language: "und",
            duration_ms: 120000,
            default: true,
            forced: false,
            properties: { width: "1920", height: "1080" },
          },
          {
            index: 1,
            kind: "audio",
            codec: "aac",
            title: "Main audio",
            language: "eng",
            duration_ms: 120000,
            default: true,
            forced: false,
            properties: { channels: "2" },
          },
        ],
      };
      const poster = {
        jpeg: coverJpeg,
        width: 160,
        height: 240,
        source_label: "generated fixture",
      };
      const subtitleAsset = {
        ...asset,
        id: "sub1",
        path: "/media/Film.srt",
        format: "srt",
        metadata: {},
        streams: [
          {
            index: 0,
            kind: "subtitle",
            codec: "subrip",
            title: "Downloaded subtitle",
            language: "eng",
            duration_ms: 2000,
            default: false,
            forced: false,
            properties: {},
          },
        ],
      };
      const imageAsset = {
        ...asset,
        id: "cover-image",
        path: "/media/Cover.avif",
        format: "mov,mp4,m4a,3gp,3g2,mj2",
        duration_ms: null,
        metadata: { major_brand: "avif" },
        chapters: [],
        streams: [
          {
            ...asset.streams[0],
            codec: "av1",
            duration_ms: null,
            properties: { still_image: "1", width: "160", height: "240" },
          },
        ],
      };
      Object.assign(window, {
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      });
      const eventHandlers = new Map<string, number>();
      Object.assign(window, {
        __reelioDrop: (payload: unknown) => {
          const id = eventHandlers.get("media:dropped");
          const callback = id === undefined ? undefined : callbacks.get(id);
          if (typeof callback === "function")
            callback({ event: "media:dropped", id, payload });
        },
      });
      let queuedKind = "artwork";
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          transformCallback: (fn: unknown) => {
            const id = ++sequence;
            callbacks.set(id, fn);
            return id;
          },
          unregisterCallback: (id: number) => callbacks.delete(id),
          convertFileSrc: () => "/unplayable-test-source",
          invoke: async (cmd: string, args: Record<string, unknown>) => {
            if (cmd === "interface_zoom") {
              localStorage.setItem(
                "test-native-interface-zoom",
                String(args.percent),
              );
              return;
            }
            if (cmd === "export_start") {
              localStorage.setItem(
                "test-export-project-id",
                String((args.project as { id: string }).id),
              );
              localStorage.setItem("test-export-request", JSON.stringify(args));
              localStorage.setItem(
                "test-export-count",
                String(
                  Number(localStorage.getItem("test-export-count") || 0) + 1,
                ),
              );
              if (localStorage.getItem("test-live-export")) {
                localStorage.setItem("test-live-job-status", "processing");
                return "fitted-export";
              }
              return null;
            }
            if (cmd === "backend_status")
              return {
                ffmpeg_version: "FFmpeg test boundary",
                ffprobe_version: "FFprobe test boundary",
                muxers: ["mp4", "matroska"],
                subtitle_encoders: ["mov_text"],
              };
            if (cmd === "dependencies_status" || cmd === "dependencies_repair")
              return {
                preview_available: true,
                network_available: true,
                backend_available: true,
                missing_components: [],
                repair_supported: true,
                repair_hint: "",
                packages: [],
              };
            if (cmd === "settings_get")
              return {
                theme: "light",
                recents: [],
                backend: null,
                image_format:
                  localStorage.getItem("test-image-format") || "png",
                default_folder:
                  localStorage.getItem("test-default-folder") ||
                  "/home/test/Videos",
              };
            if (cmd === "settings_choose_folder") return "/workspace/output";
            if (cmd === "settings_update") {
              if (args?.key === "image_format") {
                localStorage.setItem("test-image-format", args.value as string);
                return null;
              }
              if (args?.key === "default_folder") {
                if (args.value !== null && args.value !== "/workspace/output")
                  throw new Error("Choose an existing absolute folder path");
                localStorage.setItem(
                  "test-default-folder",
                  args.value === null
                    ? "/home/test/Videos"
                    : (args.value as string),
                );
                return null;
              }
              localStorage.setItem(
                "test-theme-preference",
                JSON.stringify(args),
              );
              return null;
            }
            if (cmd === "poster_search") {
              localStorage.setItem("test-search", JSON.stringify(args));
              const offset = Number(args.offset || 0);
              const results = Array.from({ length: 35 }, (_, i) => {
                const index = offset + i;
                return {
                  title:
                    index === 0
                      ? "Fixture Movie"
                      : index === 1
                        ? "Unavailable poster"
                        : `Extra cover ${index}`,
                  source_host: "example.com",
                  image_url:
                    index === 0
                      ? "https://example.com/poster-result.jpg"
                      : index === 1
                        ? "https://example.com/blocked.jpg"
                        : `https://example.com/extra-${index}.jpg`,
                  thumbnail_url: `https://example.com/thumbnail-${index}.jpg`,
                  width: 1600,
                  height: 900,
                };
              });
              return {
                results,
                next_offset: offset + 35,
                has_more: offset < 70,
              };
            }
            if (cmd === "poster_image") {
              if (args.url === "https://example.com/blocked.jpg")
                throw new Error(
                  "Image host refused the download; the existing cover is unchanged",
                );
              if (!String(args.url).includes("thumbnail"))
                localStorage.setItem(
                  "test-poster-selection",
                  JSON.stringify(args),
                );
              return poster;
            }
            if (cmd === "preview_source") {
              localStorage.setItem(
                "test-preview-requests",
                String(
                  Number(localStorage.getItem("test-preview-requests") || 0) +
                    1,
                ),
              );
              return previewVideo;
            }
            if (cmd === "choose_artwork") return poster;
            if (cmd === "artwork_import") {
              if (args.path !== imageAsset.path)
                throw new Error("Drop a still image, not a video");
              return {
                asset: imageAsset,
                artwork: { ...poster, source_label: "Cover.avif" },
              };
            }
            if (cmd === "artwork_save_copy") {
              localStorage.setItem(
                "test-saved-image",
                JSON.stringify(args.artwork),
              );
              const mode = localStorage.getItem("test-image-save-mode");
              if (mode === "cancel") return null;
              if (mode === "error")
                throw new Error(
                  "Destination exists. Choose a new image filename.",
                );
              return (
                "/workspace/cover-preview." +
                (localStorage.getItem("test-image-format") === "jpeg"
                  ? "jpg"
                  : "png")
              );
            }
            if (cmd === "artwork_edit") {
              const delay = Number(
                localStorage.getItem("test-image-delay") || 0,
              );
              if (delay)
                await new Promise((resolve) => setTimeout(resolve, delay));
              localStorage.setItem(
                "test-image-edits",
                JSON.stringify(args.edits),
              );
              return args.artwork;
            }
            if (cmd === "search_browser_open") {
              localStorage.setItem("test-search", JSON.stringify(args));
              return null;
            }
            if (cmd === "resource_queue") {
              queuedKind = String(args.kind);
              return {
                id: "download1",
                kind: queuedKind,
                host: "example.com",
                name: queuedKind === "artwork" ? "poster.jpg" : "subtitles.zip",
              };
            }
            if (cmd === "resource_download")
              return queuedKind === "artwork"
                ? { kind: "artwork", artwork: poster }
                : {
                    kind: "subtitles",
                    files: [{ path: subtitleAsset.path, name: "Film.srt" }],
                  };
            if (cmd === "choose_subtitles") return [subtitleAsset.path];
            if (cmd === "subtitle_preview")
              return "WEBVTT\n\n00:00.200 --> 00:01.500\nFixture subtitle\n\n00:01.600 --> 00:02.000\nSecond cue\n";
            if (cmd === "update_check") {
              const mode = localStorage.getItem("test-update-mode") || "none";
              if (mode === "error")
                throw new Error("GitHub returned HTTP 403; retry later.");
              return {
                current_version: "0.2.0-1",
                latest_version: mode === "none" ? null : "0.3.0-1",
                status:
                  mode === "none"
                    ? "no_releases"
                    : mode === "unsupported"
                      ? "unsupported"
                      : "available",
                message:
                  mode === "none"
                    ? "No published stable GitHub releases are available yet."
                    : mode === "unsupported"
                      ? "A newer release exists, but it has no compatible package for this system."
                      : "A newer verified-download candidate is available.",
                asset_name:
                  mode === "available"
                    ? "reelio-0.3.0-1-x86_64.pkg.tar.zst"
                    : null,
                bytes: 100,
                offer_id: mode === "available" ? "fixture-offer" : null,
              };
            }
            if (cmd === "update_download") {
              localStorage.setItem("test-update-offer", String(args.offerId));
              if (localStorage.getItem("test-update-hold"))
                return new Promise((_, reject) => {
                  (window as any).__cancelUpdate = () =>
                    reject(new Error("Update download cancelled"));
                });
              return "/downloads/reelio-0.3.0-1-x86_64.pkg.tar.zst";
            }
            if (cmd === "update_cancel") {
              (window as any).__cancelUpdate?.();
              return;
            }
            if (cmd === "app_version") return "0.2.0-1";
            if (cmd === "window_action") {
              const action = String(args.action);
              if (action !== "state") {
                const actions = JSON.parse(
                  localStorage.getItem("test-window-actions") || "[]",
                );
                actions.push(action);
                localStorage.setItem(
                  "test-window-actions",
                  JSON.stringify(actions),
                );
              }
              if (action === "toggle_maximize")
                localStorage.setItem(
                  "test-window-maximized",
                  localStorage.getItem("test-window-maximized") === "yes"
                    ? "no"
                    : "yes",
                );
              return localStorage.getItem("test-window-maximized") === "yes";
            }
            if (cmd === "open_project_homepage") {
              localStorage.setItem("test-homepage-opened", "yes");
              return null;
            }
            if (cmd === "choose_media") {
              const delay = Number(
                localStorage.getItem("test-media-delay") || 0,
              );
              localStorage.removeItem("test-media-delay");
              if (delay)
                await new Promise((resolve) => setTimeout(resolve, delay));
              const next = localStorage.getItem("test-next-media");
              localStorage.removeItem("test-next-media");
              return next ? JSON.parse(next) : [asset.path];
            }
            if (cmd === "media_probe") {
              if (args.path === imageAsset.path) return imageAsset;
              if (
                args.path === "/media/Music.wav" ||
                args.path === "/media/French.m4a"
              ) {
                const french = args.path === "/media/French.m4a";
                return {
                  ...asset,
                  id: french ? "french" : "music",
                  path: args.path,
                  format: french ? "mov" : "wav",
                  metadata: {},
                  streams: [
                    {
                      ...asset.streams[1],
                      index: 0,
                      title: french ? "French" : "Music",
                      language: french ? "fra" : "und",
                      default: false,
                    },
                  ],
                };
              }
              if (args.path === "/media/Alt.srt")
                return {
                  ...subtitleAsset,
                  id: "altsub",
                  path: args.path,
                  streams: [
                    {
                      ...subtitleAsset.streams[0],
                      title: "Alternate subtitles",
                    },
                  ],
                };
              return args.path === subtitleAsset.path ? subtitleAsset : asset;
            }
            if (cmd === "project_open") {
              localStorage.setItem(
                "test-project-opens",
                String(
                  Number(localStorage.getItem("test-project-opens") || 0) + 1,
                ),
              );
              const mode = localStorage.getItem("test-project-open-mode");
              if (mode === "cancel") return null;
              if (mode === "fail")
                throw new Error(
                  "Project could not be opened; current project is unchanged",
                );
              return JSON.parse(
                localStorage.getItem("test-saved-project") || "null",
              );
            }
            if (cmd === "project_save") {
              localStorage.setItem(
                "test-saved-project",
                JSON.stringify(args.project),
              );
              return "/media/Film.reelio";
            }
            if (cmd === "jobs_list") {
              const status = localStorage.getItem("test-live-job-status");
              return status
                ? [
                    {
                      id: "fitted-export",
                      project_id: localStorage.getItem(
                        "test-export-project-id",
                      ),
                      sequence: status === "completed" ? 2 : 1,
                      status,
                      destination: "/tmp/fitted-output.mkv",
                      error: null,
                      created_at: "2026-10-19T00:00:00Z",
                      progress: {
                        phase: status,
                        percent: status === "completed" ? 100 : 50,
                        processed_ms: 4000,
                        bytes: 1000,
                        elapsed_ms: 100,
                        notices:
                          status === "completed"
                            ? [
                                "Cropped Long audio [audio-id] to video timeline: output 0..4000 ms.",
                                "Omitted Empty subtitle [subtitle-id]: no cues intersect the video timeline.",
                              ]
                            : [],
                      },
                    },
                  ]
                : [];
            }
            if (cmd === "plugin:event|listen") {
              eventHandlers.set(String(args.event), Number(args.handler));
              return ++sequence;
            }
            if (cmd === "project_validate" || cmd === "export_plan") {
              const project = args.project as {
                container: string;
                assets: (typeof asset)[];
                tracks: {
                  id: string;
                  asset_id: string;
                  default: boolean;
                  enabled: boolean;
                  stream_index: number;
                }[];
              };
              const enabled = project.tracks.filter((t) => t.enabled);
              const kind = (t: (typeof enabled)[number]) =>
                project.assets
                  .find((a) => a.id === t.asset_id)
                  ?.streams.find((s) => s.index === t.stream_index)?.kind;
              const outputDefault = (t: (typeof enabled)[number]) =>
                t.default ||
                (project.container !== "matroska" &&
                  !enabled.some(
                    (other) => kind(other) === kind(t) && other.default,
                  ) &&
                  enabled.find((other) => kind(other) === kind(t))?.id ===
                    t.id);
              return {
                tracks: project.tracks
                  .filter((t) => t.enabled)
                  .map((t, i) => ({
                    track_id: t.id,
                    output_index: i,
                    source_index: t.stream_index,
                    asset_id: "a1",
                    default: outputDefault(t),
                    compatibility: {
                      action:
                        i === 0
                          ? localStorage.getItem("test-export-action") || "copy"
                          : "copy",
                      reason: "Fixture operation",
                      warning: null,
                      target_codec: null,
                    },
                  })),
                errors: [],
                warnings: ["Structure verification only"],
                duration_ms: 120000,
                estimated_bytes: asset.size,
              };
            }
            return null;
          },
        },
      });
    },
    { coverJpeg, previewVideo },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Project menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "About Reelio", exact: true })
    .click();
  const nativeAbout = page.getByRole("dialog", {
    name: "About Reelio",
    exact: true,
  });
  await expect(
    nativeAbout.getByText("Version 0.2.0-1", { exact: true }),
  ).toBeVisible();
  await nativeAbout.getByRole("link").click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("test-homepage-opened")),
    )
    .toBe("yes");
  await nativeAbout.getByRole("button", { name: "Close", exact: true }).click();
  await expect(nativeAbout).toBeHidden();
  {
    await selectProjectAction(page, "Check for updates");
    const updates = page.getByRole("dialog", {
      name: "Software updates",
      exact: true,
    });
    await expect(
      updates.getByText(
        "No published stable GitHub releases are available yet.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      updates.getByRole("button", { name: "Download package" }),
    ).toHaveCount(0);
    await page.evaluate(() =>
      localStorage.setItem("test-update-mode", "available"),
    );
    await updates.getByRole("button", { name: "Check again" }).click();
    await expect(updates.getByText("0.3.0-1", { exact: true })).toBeVisible();
    await updates.getByRole("button", { name: "Download package" }).click();
    await expect(updates.getByText(/Verified package saved:/)).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("test-update-offer")),
    ).toBe("fixture-offer");
    await page.evaluate(() => localStorage.setItem("test-update-hold", "yes"));
    await updates.getByRole("button", { name: "Download package" }).click();
    await expect(
      updates.getByRole("button", { name: "Close", exact: true }),
    ).toBeDisabled();
    await updates.getByRole("button", { name: "Cancel download" }).click();
    await expect(
      updates.getByText(
        "Update download cancelled; no package was published.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.evaluate(() => {
      localStorage.removeItem("test-update-hold");
      localStorage.setItem("test-update-mode", "unsupported");
    });
    await updates.getByRole("button", { name: "Check again" }).click();
    await expect(updates.getByText(/no compatible package/)).toBeVisible();
    await expect(
      updates.getByRole("button", { name: "Download package" }),
    ).toHaveCount(0);
    await page.evaluate(() =>
      localStorage.setItem("test-update-mode", "error"),
    );
    await updates.getByRole("button", { name: "Check again" }).click();
    await expect(updates.getByRole("alert")).toContainText("HTTP 403");
    await expect(
      updates.getByText("This installation is up to date.", { exact: true }),
    ).toHaveCount(0);
    await updates.getByRole("button", { name: "Close", exact: true }).click();
    await expect(updates).toBeHidden();
  }
  const windowBar = page.getByRole("banner", { name: "Window top bar" });
  expect((await windowBar.boundingBox())!.y).toBe(0);
  const windowButtons = windowBar.getByRole("group", {
    name: "Window controls",
  });
  await windowButtons.getByRole("button", { name: "Minimize window" }).click();
  await windowButtons.getByRole("button", { name: "Maximize window" }).click();
  await windowButtons.getByRole("button", { name: "Restore window" }).click();
  await windowBar.getByRole("link", { name: "Reelio home" }).dblclick();
  await windowButtons.getByRole("button", { name: "Restore window" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("test-window-actions") || "[]"),
      ),
    )
    .toEqual([
      "minimize",
      "toggle_maximize",
      "toggle_maximize",
      "drag",
      "toggle_maximize",
      "toggle_maximize",
    ]);
  await page.keyboard.press("Control+=");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("test-native-interface-zoom")),
    )
    .toBe("110");
  await page.keyboard.press("Control+0");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("test-native-interface-zoom")),
    )
    .toBe("100");
  await page
    .getByRole("button", { name: "Open media files", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Timeline editor" })
      .locator(".lane-video"),
  ).toHaveCount(1);
  await page.getByRole("tab", { name: /^All tracks/ }).click();
  await expect(
    page.getByRole("button", { name: /Picture H264/ }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Include Main audio track 1" })
    .uncheck();
  await expect(page.getByText("1 of 2 tracks included")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Include Main audio track 1" }),
  ).toBeChecked();
  await page.getByRole("tab", { name: "Metadata", exact: true }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Right inspector" })
      .getByRole("region", { name: "Project tools" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".workspace")
        .evaluate((el) => el.parentElement?.classList.contains("inspector")),
    )
    .toBe(true);
  await page.getByLabel("title", { exact: true }).fill("Edited title");
  await selectProjectAction(page, "Save project");
  await expect(page.getByRole("status")).toContainText("Project saved");
  await page.getByRole("button", { name: "Collapse right sidebar" }).click();
  await expect(
    page.getByRole("complementary", { name: "Right inspector" }),
  ).toBeHidden();
  await page.getByRole("tab", { name: "Metadata", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Right inspector" }),
  ).toBeVisible();
  await expect(page.getByText("Unsaved changes", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("tab", { name: "Export & history" }).click();
  await expect(
    page.getByRole("button", { name: "Choose destination & export" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "MP4", exact: true }).click();
  await page.getByRole("tab", { name: /^All tracks/ }).click();
  const audioDefault = page.getByRole("checkbox", {
    name: "Default Main audio",
    exact: true,
  });
  await audioDefault.click();
  await expect(audioDefault).toBeChecked();
  await expect(audioDefault).toHaveAttribute("title", /Automatically selected/);
  await expect(
    audioDefault.locator("..").getByText("Auto", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Export & history", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Choose destination & export",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.getByText(/export notices/)).toHaveCount(0);
  await expect(page.getByText(/I authorize the listed/)).toHaveCount(0);
  const exportButton = page.getByRole("button", {
    name: "Choose destination & export",
    exact: true,
  });
  const reviewExport = async (accept: boolean, conversion: boolean) => {
    const pending = page.waitForEvent("dialog");
    const clicking = exportButton.click();
    const confirmation = await pending;
    expect(confirmation.message()).toContain("Structure verification only");
    expect(confirmation.message().includes("Continuing authorizes")).toBe(
      conversion,
    );
    if (conversion)
      expect(confirmation.message()).toContain("Output track #1: Render video");
    if (accept) await confirmation.accept();
    else await confirmation.dismiss();
    await clicking;
  };
  await reviewExport(false, false);
  expect(
    await page.evaluate(() => localStorage.getItem("test-export-count")),
  ).toBeNull();
  await reviewExport(true, false);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-export-request") || "{}")
            .approveConversion,
      ),
    )
    .toBe(false);
  await page.evaluate(() =>
    localStorage.setItem("test-export-action", "render_video"),
  );
  await page.getByRole("button", { name: "MKV", exact: true }).click();
  await expect(page.getByText("Render video", { exact: true })).toBeVisible();
  await expect(exportButton).toBeEnabled();
  await reviewExport(false, true);
  expect(
    await page.evaluate(() => localStorage.getItem("test-export-count")),
  ).toBe("1");
  await reviewExport(true, true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-export-request") || "{}")
            .approveConversion,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("test-export-count")))
    .toBe("2");
  await reviewExport(false, true);
  expect(
    await page.evaluate(() => localStorage.getItem("test-export-count")),
  ).toBe("2");
  await expect(page.locator(".approval, .warnings")).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("test-export-action"));
  await page.getByRole("button", { name: "MP4", exact: true }).click();
  await expect(page.getByText("Render video", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "MKV", exact: true }).click();
  await expect(exportButton).toBeEnabled();
  await page.evaluate(() => localStorage.setItem("test-live-export", "1"));
  await reviewExport(true, false);
  await expect(
    page.getByText("fitted-output.mkv", { exact: true }),
  ).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await page.evaluate(() =>
    localStorage.setItem("test-live-job-status", "completed"),
  );
  await expect(page.getByRole("status")).toContainText(
    "Export completed with 2 timeline adjustments",
  );
  await expect(page.locator(".job-adjustments")).toContainText(
    "Cropped Long audio",
  );
  await expect(page.locator(".job-adjustments")).toContainText(
    "Omitted Empty subtitle",
  );
  await expect(exportButton).toBeEnabled();
  await page.getByRole("tab", { name: "Metadata", exact: true }).click();
  await page
    .getByRole("tab", { name: "Export & history", exact: true })
    .click();
  await expect(page.locator(".job-adjustments")).toContainText(
    "Omitted Empty subtitle",
  );
  await page.screenshot({
    path: testInfo.outputPath("video-timeline-crop-report.png"),
    fullPage: true,
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(245, 246, 248)",
  );
  await page.screenshot({
    path: testInfo.outputPath("pigeon-light-export.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Appearance").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(24, 25, 27)",
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("test-theme-preference")),
    )
    .toBe(JSON.stringify({ key: "theme", value: "dark" }));
  await page.screenshot({
    path: testInfo.outputPath("pigeon-dark-settings.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await dialog.getByLabel("Appearance").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByLabel("Appearance").selectOption("dark");
  await expect(
    dialog.getByLabel("Default folder", { exact: true }),
  ).toHaveValue("/home/test/Videos");
  await dialog
    .getByRole("button", { name: "Browse folder", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Default folder", { exact: true }),
  ).toHaveValue("/workspace/output");
  await dialog
    .getByRole("button", { name: "Save default folder", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    dialog.getByLabel("Default folder", { exact: true }),
  ).toHaveValue("/workspace/output");
  await dialog.getByLabel("Default folder", { exact: true }).fill("/missing");
  await dialog
    .getByRole("button", { name: "Save default folder", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "existing absolute folder",
  );
  await dialog
    .getByRole("button", { name: "Reset to Videos", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Default folder", { exact: true }),
  ).toHaveValue("/home/test/Videos");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByLabel("Default image format")).toHaveValue("png");
  await dialog.getByLabel("Default image format").selectOption("jpeg");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("test-image-format")))
    .toBe("jpeg");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("pigeon-dark-export.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Poster & cover" }).click();
  const movieTitle = page.getByRole("textbox", {
    name: "Movie title",
    exact: true,
  });
  await movieTitle.fill("Fixture Movie 2026");
  await page
    .getByRole("button", { name: "Search posters", exact: true })
    .focus();
  await movieTitle.click();
  await expect
    .poll(() =>
      movieTitle.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    )
    .toEqual([0, "Fixture Movie 2026".length]);
  expect(
    await movieTitle.evaluate((input) => {
      const selection = getComputedStyle(input, "::selection");
      return [selection.backgroundColor, selection.color];
    }),
  ).toEqual(["rgb(49, 95, 196)", "rgb(255, 255, 255)"]);
  await page
    .locator(".poster-search-toolbar")
    .screenshot({ path: testInfo.outputPath("poster-title-selected.png") });
  await page.keyboard.press("ArrowRight");
  expect(
    await movieTitle.evaluate(
      (input: HTMLInputElement) => input.selectionStart === input.selectionEnd,
    ),
  ).toBe(true);
  await page.keyboard.press("Control+a");
  expect(
    await movieTitle.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
    ]),
  ).toEqual([0, "Fixture Movie 2026".length]);
  await page
    .getByRole("button", { name: "Clear movie title", exact: true })
    .click();
  await expect(movieTitle).toHaveValue("");
  await expect(movieTitle).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Clear movie title", exact: true }),
  ).toHaveCount(0);
  await movieTitle.fill("Fixture Movie 2026");
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 1332, height: 1046 });
    const boxes = await Promise.all(
      [
        movieTitle,
        page.getByRole("button", { name: "Search posters", exact: true }),
        page.getByRole("group", { name: "Image orientation", exact: true }),
        page.getByRole("combobox", { name: "Image proportions", exact: true }),
        page.getByRole("combobox", { name: "Results per page", exact: true }),
      ].map((element) => element.boundingBox()),
    );
    const panel = (await page
      .getByRole("region", { name: "Lower workspace" })
      .boundingBox())!;
    for (const box of boxes) {
      expect(box!.x).toBeGreaterThanOrEqual(panel.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        panel.x + panel.width + 1,
      );
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!,
          b = boxes[j]!;
        expect(
          a.x + a.width <= b.x + 1 ||
            b.x + b.width <= a.x + 1 ||
            a.y + a.height <= b.y + 1 ||
            b.y + b.height <= a.y + 1,
        ).toBe(true);
      }
  }
  await page
    .locator(".poster-search-toolbar")
    .screenshot({ path: testInfo.outputPath("poster-search-toolbar.png") });
  await page
    .getByRole("button", { name: "Search posters", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("test-search")))
    .toContain("Fixture Movie 2026");
  const posterBrowser = page.getByRole("region", {
    name: "Internal poster browser",
  });
  await expect(posterBrowser).toBeVisible();
  await expect(posterBrowser.locator(".poster-result")).toHaveCount(12);
  const ratioSelect = page.getByRole("combobox", {
    name: "Image proportions",
    exact: true,
  });
  await expect(
    ratioSelect.locator('option[value="landscape"],option[value="portrait"]'),
  ).toHaveCount(0);
  const landscape = page.getByRole("button", {
      name: "Landscape",
      exact: true,
    }),
    portrait = page.getByRole("button", { name: "Portrait", exact: true });
  await landscape.click();
  await expect(landscape).toHaveAttribute("aria-pressed", "true");
  await portrait.click();
  await expect(portrait).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-search") || "{}").proportion,
      ),
    )
    .toBe("portrait");
  await portrait.click();
  await expect(portrait).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("combobox", { name: "Results per page", exact: true })
    .selectOption("24");
  await expect(posterBrowser.locator(".poster-result")).toHaveCount(24);
  await page
    .getByRole("combobox", { name: "Results per page", exact: true })
    .selectOption("48");
  await expect(posterBrowser.locator(".poster-result")).toHaveCount(48);
  const gallery = posterBrowser.locator(".poster-results");
  const artworkWorkspace = page.locator(".artwork-workspace");
  const studioEnd = page.locator(".artwork-panel > :last-child");
  await gallery.locator(".poster-result").first().scrollIntoViewIfNeeded();
  if (testInfo.project.name === "desktop") {
    await artworkWorkspace.evaluate((workspace) => {
      const results = workspace.querySelector(".poster-results")!;
      workspace.scrollTop +=
        results.getBoundingClientRect().top -
        workspace.getBoundingClientRect().top -
        24;
      results.scrollTop = 0;
    });
  } else {
    await gallery.evaluate((results) => {
      results.scrollTop = 0;
      window.scrollBy(0, results.getBoundingClientRect().top - 160);
    });
  }
  const workspaceBox = (await artworkWorkspace.boundingBox())!;
  const viewport = page.viewportSize()!;
  await page.mouse.move(
    workspaceBox.x + 60,
    testInfo.project.name === "desktop"
      ? workspaceBox.y + Math.min(160, workspaceBox.height / 2)
      : viewport.height - 220,
  );
  const endIsVisible = () =>
    studioEnd.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      let top = document
        .querySelector(".toolbar")!
        .getBoundingClientRect().bottom;
      let bottom = innerHeight;
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          /(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)
        ) {
          const clip = parent.getBoundingClientRect();
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      const sidebar = document.querySelector(".sidebar")!;
      if (getComputedStyle(sidebar).position === "sticky")
        top = Math.max(top, sidebar.getBoundingClientRect().bottom);
      return bounds.top >= top && bounds.bottom <= bottom;
    });
  for (let step = 0; step < 110 && !(await endIsVisible()); step++) {
    await page.mouse.wheel(0, 200);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
  await expect(studioEnd).toBeInViewport({ ratio: 1 });
  expect(await endIsVisible()).toBe(true);
  const thumbnail = await gallery
    .locator(".poster-thumbnail")
    .first()
    .boundingBox();
  expect(thumbnail!.height).toBeCloseTo(thumbnail!.width * 1.5, 0);
  await page.screenshot({
    path: testInfo.outputPath("artwork-scrolled-to-bottom.png"),
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Image proportions", exact: true })
    .selectOption("16:9");
  await expect(posterBrowser.locator(".poster-result")).toHaveCount(48);
  await expect(landscape).toHaveAttribute("aria-pressed", "true");
  await portrait.click();
  await expect(ratioSelect).toHaveValue("9:16");
  await landscape.click();
  await expect(ratioSelect).toHaveValue("16:9");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(posterBrowser.getByRole("status")).toContainText("Page 2");
  await expect(
    posterBrowser.getByText("Extra cover 48", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(posterBrowser.getByRole("status")).toContainText("Page 1");
  await page
    .getByRole("button", {
      name: "Use cover for Fixture Movie",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Import this cover image?" }),
  ).not.toBeVisible();
  await expect(
    page.getByText("Cover applied to this project.", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-poster-selection") || "{}").url,
      ),
    )
    .toBe("https://example.com/poster-result.jpg");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-poster-selection") || "{}")
            .proportion,
      ),
    )
    .toBe("16:9");
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await page.getByRole("tab", { name: "Poster & cover", exact: true }).click();
  const useCover = page.getByRole("button", {
    name: "Use cover for Fixture Movie",
    exact: true,
  });
  await expect(useCover).toHaveText("Applied - use again");
  await page
    .getByRole("button", {
      name: "Use cover for Unavailable poster",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Image host refused the download; the existing cover is unchanged",
  );
  await expect(page.getByRole("alert")).toBeInViewport();
  await expect(useCover).toHaveText("Applied - use again");
  await page.keyboard.press("Control+z");
  await expect(useCover).toHaveText("Use this cover");
  await page.keyboard.press("Control+Shift+z");
  await expect(useCover).toHaveText("Applied - use again");
  await page
    .getByLabel("Direct image URL")
    .fill("https://example.com/poster.jpg");
  await page.getByRole("button", { name: "Review download" }).click();
  await expect(
    page.getByRole("dialog", { name: "Import this cover image?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Download & import" }).click();
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await expect(page.getByLabel("Crop x", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Crop y", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rotate right", exact: true }),
  ).toHaveAttribute("title", "Rotate right");
  await page
    .getByRole("button", { name: "Lock crop aspect ratio", exact: true })
    .click();
  await page.getByLabel("Crop width", { exact: true }).fill("80");
  await expect(page.getByLabel("Crop height", { exact: true })).toHaveValue(
    "120",
  );
  await page.getByLabel("Resize width", { exact: true }).fill("60");
  await expect(page.getByLabel("Resize height", { exact: true })).toHaveValue(
    "40",
  );
  const brightness = page.getByRole("slider", {
    name: "Image brightness",
    exact: true,
  });
  await brightness.focus();
  await brightness.press("Home");
  await expect(brightness).toHaveValue("0.1");
  await brightness.dblclick();
  await expect(brightness).toHaveValue("1");
  const contrast = page.getByRole("slider", {
    name: "Image contrast",
    exact: true,
  });
  await contrast.focus();
  await contrast.press("End");
  await expect(contrast).toHaveValue("3");
  await contrast.dblclick();
  await expect(contrast).toHaveValue("1");
  await page
    .getByRole("button", { name: "Black and white", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Black and white", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-image-edits") || "{}")
            .grayscale,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-image-edits") || "{}").rotation,
      ),
    )
    .toBe(90);
  const savePreview = page.getByRole("button", {
    name: "Save preview image",
    exact: true,
  });
  await expect(savePreview).toBeEnabled();
  await page.evaluate(() =>
    localStorage.setItem("test-image-save-mode", "cancel"),
  );
  await savePreview.click();
  await expect(page.getByText(/Preview image saved:/)).toHaveCount(0);
  await page.evaluate(() =>
    localStorage.setItem("test-image-save-mode", "error"),
  );
  await savePreview.click();
  await expect(page.getByRole("alert")).toContainText("Destination exists");
  await expect(savePreview).toBeEnabled();
  await page.evaluate(() => localStorage.removeItem("test-image-save-mode"));
  await savePreview.click();
  await expect(
    page.getByText("Preview image saved: /workspace/cover-preview.jpg", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Poster & cover", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await page.getByRole("button", { name: "Apply cover to project" }).click();
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await expect(page.locator(".artwork-workspace")).toBeHidden();
  await page.getByRole("tab", { name: "Poster & cover", exact: true }).click();
  await expect(page.locator(".artwork-apply-feedback")).toBeVisible();
  await page.locator(".artwork-apply-feedback").scrollIntoViewIfNeeded();
  await expect(page.locator(".artwork-apply-feedback")).toBeInViewport();
  {
    const studio = page.locator(".artwork-editor-grid"),
      controls = studio.locator(".artwork-control-panel"),
      live = studio.locator("canvas");
    if (testInfo.project.name === "desktop") {
      const boxes = await Promise.all(
        [
          studio.locator("figure").first(),
          controls,
          studio.locator("figure").last(),
        ].map((element) => element.boundingBox()),
      );
      expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x);
      expect(boxes[1]!.x + boxes[1]!.width).toBeLessThan(boxes[2]!.x);
      expect(
        await controls.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      ).toBeLessThanOrEqual(2);
    }
    const beforePixels = await live.evaluate((element) =>
      (element as HTMLCanvasElement).toDataURL(),
    );
    await page.evaluate(() => localStorage.setItem("test-image-delay", "1200"));
    await page.getByRole("button", { name: "Negative", exact: true }).click();
    await expect
      .poll(
        () =>
          live.evaluate((element) =>
            (element as HTMLCanvasElement).toDataURL(),
          ),
        { timeout: 500 },
      )
      .not.toBe(beforePixels);
    await expect(
      page.getByRole("button", { name: "Apply cover to project" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-image-edits") || "{}").negative,
      ),
    ).toBe(false);
    await page.evaluate(() => localStorage.removeItem("test-image-delay"));
    await page.getByRole("button", { name: "Negative", exact: true }).click();
    await page
      .getByRole("button", { name: "Poster 9:16", exact: true })
      .click();
    expect(
      Number(
        await page.getByLabel("Crop width", { exact: true }).inputValue(),
      ) /
        Number(
          await page.getByLabel("Crop height", { exact: true }).inputValue(),
        ),
    ).toBeCloseTo(9 / 16, 2);
    const portraitStyle = await page
      .getByRole("group", { name: "Move crop selection", exact: true })
      .getAttribute("style");
    await page.getByRole("button", { name: "Wide 3:2", exact: true }).click();
    expect(
      Number(
        await page.getByLabel("Crop width", { exact: true }).inputValue(),
      ) /
        Number(
          await page.getByLabel("Crop height", { exact: true }).inputValue(),
        ),
    ).toBeCloseTo(3 / 2, 1);
    const crop = page.getByRole("group", {
      name: "Move crop selection",
      exact: true,
    });
    await expect(
      crop.getByRole("button", { name: /^Resize crop/ }),
    ).toHaveCount(8);
    const presetStyle = await crop.getAttribute("style");
    await crop.click();
    await page
      .getByRole("button", { name: "Undo image edit", exact: true })
      .click();
    await expect(crop).toHaveAttribute("style", portraitStyle!);
    await page
      .getByRole("button", { name: "Redo image edit", exact: true })
      .click();
    await expect(crop).toHaveAttribute("style", presetStyle!);
    await crop.scrollIntoViewIfNeeded();
    const cropBox = (await crop.boundingBox())!;
    await page.mouse.move(
      cropBox.x + cropBox.width / 2,
      cropBox.y + cropBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      cropBox.x + cropBox.width / 2,
      cropBox.y + cropBox.height / 2 + 12,
      { steps: 6 },
    );
    await page.mouse.up();
    const movedStyle = await crop.getAttribute("style");
    expect(movedStyle).not.toBe(presetStyle);
    await page
      .getByRole("button", { name: "Undo image edit", exact: true })
      .click();
    await expect(crop).toHaveAttribute("style", presetStyle!);
    await page
      .getByRole("button", { name: "Redo image edit", exact: true })
      .click();
    await expect(crop).toHaveAttribute("style", movedStyle!);
    const cropHandle = crop.getByRole("button", {
      name: "Resize crop bottom right",
      exact: true,
    });
    const corner = (await cropHandle.boundingBox())!;
    await page.mouse.move(
      corner.x + corner.width / 2,
      corner.y + corner.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      corner.x + corner.width / 2 - 12,
      corner.y + corner.height / 2 - 12,
      { steps: 5 },
    );
    await page.mouse.up();
    expect(await crop.getAttribute("style")).not.toBe(movedStyle);
    await page
      .getByRole("button", { name: "Undo image edit", exact: true })
      .click();
    await expect(crop).toHaveAttribute("style", movedStyle!);
    const cancelBox = (await crop.boundingBox())!;
    await page.mouse.move(
      cancelBox.x + cancelBox.width / 2,
      cancelBox.y + cancelBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      cancelBox.x + cancelBox.width / 2,
      cancelBox.y + cancelBox.height / 2 + 8,
      { steps: 3 },
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(crop).toHaveAttribute("style", movedStyle!);
    await cropHandle.focus();
    await cropHandle.press("Shift+ArrowLeft");
    expect(await crop.getAttribute("style")).not.toBe(movedStyle);
    await crop
      .getByRole("button", { name: "Clear crop selection", exact: true })
      .click();
    await expect(crop).toHaveCount(0);
    await page
      .getByRole("button", { name: "Undo image edit", exact: true })
      .click();
    await expect(crop).toBeVisible();
    if (testInfo.project.name === "desktop") {
      const vertical = page.getByRole("separator", {
          name: "Resize viewer and lower workspace",
          exact: true,
        }),
        viewer = page.getByRole("region", {
          name: "Video viewer",
          exact: true,
        });
      const oldHeight = (await viewer.boundingBox())!.height;
      await vertical.focus();
      await vertical.press("ArrowUp");
      await expect
        .poll(async () => (await viewer.boundingBox())!.height)
        .toBeLessThan(oldHeight);
      expect(
        await page.evaluate(() =>
          localStorage.getItem("reelio.viewer-height.v1"),
        ),
      ).not.toBeNull();
      const dividerBox = (await vertical.boundingBox())!;
      await page.mouse.move(
        dividerBox.x + dividerBox.width / 2,
        dividerBox.y + 4,
      );
      await page.mouse.down();
      await page.mouse.move(
        dividerBox.x + dividerBox.width / 2,
        dividerBox.y - 25,
        { steps: 5 },
      );
      await page.mouse.up();
      await expect
        .poll(async () => (await viewer.boundingBox())!.height)
        .toBeLessThan(oldHeight - 20);
      await vertical.dblclick();
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem("reelio.viewer-height.v1")),
        )
        .toBeNull();
    }
  }
  await page.screenshot({
    path: testInfo.outputPath("artwork-editor.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();
  await page.getByRole("button", { name: "At playhead", exact: true }).click();
  const startTime = page.getByRole("textbox", {
    name: "Chapter 1 start time",
    exact: true,
  });
  await expect(startTime).toHaveValue("00:00:00.000");
  const chapterTitle = page.getByRole("textbox", {
    name: "Chapter 1 title",
    exact: true,
  });
  expect(
    Math.abs(
      (await chapterTitle.boundingBox())!.y -
        (await startTime.boundingBox())!.y,
    ),
  ).toBeLessThan(1);
  await expect(page.locator(".chapter-row").first()).toHaveText("01");
  await expect(
    page.getByRole("img", { name: "Chapter timing information", exact: true }),
  ).toHaveAttribute("title", /Start times use HH:MM:SS/);
  await startTime.fill("00:00:01.234");
  await startTime.press("Tab");
  await expect(startTime).toHaveValue("00:00:01.234");
  await expect(page.getByLabel("End ms", { exact: true })).toHaveCount(0);
  await selectProjectAction(page, "Save project");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-saved-project") || "{}")
            .chapters?.[0]?.start_ms,
      ),
    )
    .toBe(1234);
  await page.screenshot({
    path: testInfo.outputPath("chapters-start-times.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Subtitle Studio", exact: true }).click();
  const studio = page
    .locator(".lower-workspace")
    .getByRole("region", { name: "Subtitle Studio", exact: true });
  await expect(studio).toBeVisible();
  await expect(page.locator(".inspector .subtitle-tools")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Subtitle Studio", exact: true }),
  ).toHaveCount(0);
  await studio.getByRole("button", { name: "New SRT", exact: true }).click();
  await studio
    .getByRole("textbox", { name: "Subtitle cue text", exact: true })
    .fill("Studio draft survives navigation");
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(studio).toBeHidden();
  await page.getByRole("tab", { name: "Subtitle Studio", exact: true }).click();
  await expect(
    studio.getByRole("textbox", { name: "Subtitle cue text", exact: true }),
  ).toHaveValue("Studio draft survives navigation");
  const modelHelp = studio.getByRole("button", {
    name: "Local model translation information",
    exact: true,
  });
  await modelHelp.focus();
  await expect(studio.getByRole("tooltip")).toContainText("127.0.0.1:11434");
  await modelHelp.press("Escape");
  await expect(studio.getByRole("tooltip")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await studio
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(
    studio.getByRole("button", { name: "Discard draft", exact: true }),
  ).toBeDisabled();
  await studio.getByText("Search, import & preview", { exact: true }).click();
  await page
    .getByLabel("Direct subtitle or ZIP URL")
    .fill("https://example.com/subtitles.zip");
  await page.getByRole("button", { name: "Review download" }).click();
  await page.getByRole("button", { name: "Download & import" }).click();
  await page
    .getByRole("button", { name: "Add & test subtitle", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Subtitle test: 2 cues" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture subtitle", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("subtitle-test.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    localStorage.setItem(
      "test-next-media",
      JSON.stringify([
        "/media/Music.wav",
        "/media/French.m4a",
        "/media/Alt.srt",
      ]),
    ),
  );
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  const editor = page.getByRole("region", { name: "Timeline editor" });
  const addTracks = editor
    .locator(".timeline-toolbar")
    .getByRole("button", { name: "Add tracks", exact: true });
  await expect(addTracks).toBeVisible();
  await expect(addTracks).toBeEnabled();
  await page.evaluate(() => localStorage.setItem("test-media-delay", "750"));
  await addTracks.click();
  await expect(addTracks).toBeDisabled();
  await expect(addTracks).toBeEnabled();
  await expect(editor.locator(".lane-audio")).toHaveCount(3);
  await expect(editor.locator(".lane-subtitle")).toHaveCount(2);
  const musicLane = editor.getByRole("article", {
    name: "audio timeline Music",
    exact: true,
  });
  const frenchLane = editor.getByRole("article", {
    name: "audio timeline French",
    exact: true,
  });
  await frenchLane
    .getByRole("combobox", { name: /^Audio output / })
    .selectOption("separate");
  await frenchLane.locator(".lane-language").fill("fra");
  const videoLane = editor.locator(".lane-video").first();
  const videoViewport = videoLane.locator(".lane-viewport");
  const mainVideoButton = videoLane.getByRole("button", {
    name: /^Set .* as main video$/,
  });
  await expect(mainVideoButton).toHaveAttribute("aria-pressed", "false");
  await mainVideoButton.click();
  await expect(mainVideoButton).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(mainVideoButton).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(mainVideoButton).toHaveAttribute("aria-pressed", "true");
  await selectProjectAction(page, "Save project");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("test-saved-project") || "{}")
          .main_video_track_id,
    ),
  ).toBe(await videoLane.getAttribute("data-track-id"));
  await mainVideoButton.click();
  await expect(mainVideoButton).toHaveAttribute("aria-pressed", "false");
  const readTimelinePoint = (viewport: typeof videoViewport, pointer: number) =>
    viewport.evaluate((el, x) => {
      const ticks = Array.from(
        el.querySelectorAll<HTMLElement>(".lane-ruler span"),
      );
      const clock = (text: string) => {
        const [h, m, s] = text.split(":").map(Number);
        return ((h * 60 + m) * 60 + s) * 1000;
      };
      const scale =
        (parseFloat(ticks[1].style.left) - parseFloat(ticks[0].style.left)) /
        (clock(ticks[1].textContent!) - clock(ticks[0].textContent!));
      return { time: (el.scrollLeft + x) / scale, scale };
    }, pointer);
  await videoViewport.hover();
  const zoomBounds = (await videoViewport.boundingBox())!;
  const zoomPointer = zoomBounds.width * 0.6;
  await page.mouse.move(zoomBounds.x + zoomPointer, zoomBounds.y + 20);
  const beforeCursorZoom = await readTimelinePoint(videoViewport, zoomPointer);
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, -150);
  await page.keyboard.up("Alt");
  await expect
    .poll(async () => Number(await videoViewport.getAttribute("data-zoom")))
    .toBeGreaterThan(1);
  await expect
    .poll(async () => {
      const point = await readTimelinePoint(videoViewport, zoomPointer);
      return Math.abs(point.time - beforeCursorZoom.time) * point.scale;
    })
    .toBeLessThan(2);
  await videoViewport.evaluate(
    (el, position) => {
      for (let i = 0; i < 8; i++)
        el.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            altKey: true,
            deltaY: -15,
            clientX: position.x,
            clientY: position.y,
          }),
        );
    },
    { x: zoomBounds.x + zoomPointer, y: zoomBounds.y + 20 },
  );
  await expect
    .poll(async () => {
      const point = await readTimelinePoint(videoViewport, zoomPointer);
      return Math.abs(point.time - beforeCursorZoom.time) * point.scale;
    })
    .toBeLessThan(2);
  const beforeButtonZoom = Number(
    await videoViewport.getAttribute("data-zoom"),
  );
  await page
    .getByRole("button", { name: "Zoom timeline in", exact: true })
    .click();
  await expect
    .poll(async () => Number(await videoViewport.getAttribute("data-zoom")))
    .toBeGreaterThan(beforeButtonZoom);
  await expect
    .poll(async () => {
      const marker = await videoLane
        .locator(".lane-playhead")
        .evaluate((el) => el.getBoundingClientRect().x);
      const viewport = (await videoViewport.boundingBox())!;
      return marker >= viewport.x - 1 && marker < viewport.x + viewport.width;
    })
    .toBe(true);
  const beforeFallbackZoom = Number(
    await videoViewport.getAttribute("data-zoom"),
  );
  await page
    .getByRole("button", { name: "Zoom timeline out", exact: true })
    .hover();
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, 80);
  await page.keyboard.up("Alt");
  await expect
    .poll(async () => Number(await videoViewport.getAttribute("data-zoom")))
    .toBeLessThan(beforeFallbackZoom);
  await expect
    .poll(() => videoViewport.evaluate((el) => el.scrollLeft))
    .toBe(0);
  await videoViewport.hover();
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Alt");
  await expect
    .poll(async () => Number(await videoViewport.getAttribute("data-zoom")))
    .toBeGreaterThan(1);
  const sharedZoom = await videoViewport.getAttribute("data-zoom");
  for (const lane of await editor.locator(".lane-viewport").all())
    await expect(lane).toHaveAttribute("data-zoom", sharedZoom!);
  await videoViewport.evaluate((el) => {
    el.scrollLeft = 80;
  });
  await expect
    .poll(() =>
      musicLane.locator(".lane-viewport").evaluate((el) => el.scrollLeft),
    )
    .toBeCloseTo(await videoViewport.evaluate((el) => el.scrollLeft), 0);
  await editor.getByRole("button", { name: /%$/ }).click();
  const trimStart = videoLane.getByRole("slider", { name: /^Trim start / });
  const trimEnd = videoLane.getByRole("slider", { name: /^Trim end / });
  const originalEnd = Number(await trimEnd.getAttribute("aria-valuenow"));
  await trimStart.press("ArrowRight");
  await expect(trimStart).toHaveAttribute("aria-valuenow", "100");
  await expect(trimEnd).toHaveAttribute("aria-valuenow", String(originalEnd));
  await trimStart.press("Home");
  await expect(trimStart).toHaveAttribute("aria-valuenow", "0");
  await trimEnd.press("ArrowLeft");
  await expect(trimEnd).toHaveAttribute(
    "aria-valuenow",
    String(originalEnd - 100),
  );
  await trimEnd.press("End");
  await trimStart.scrollIntoViewIfNeeded();
  let handle = (await trimStart.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 28,
    handle.y + handle.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  const retainedStart = Number(await trimStart.getAttribute("aria-valuenow"));
  expect(retainedStart).toBeGreaterThan(100);
  await trimEnd.scrollIntoViewIfNeeded();
  handle = (await trimEnd.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 35,
    handle.y + handle.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  const retainedEnd = Number(await trimEnd.getAttribute("aria-valuenow"));
  expect(retainedEnd).toBeLessThan(originalEnd);
  await editor.screenshot({ path: testInfo.outputPath("trimmed-clips.png") });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(trimEnd).toHaveAttribute("aria-valuenow", String(originalEnd));
  await expect(trimStart).toHaveAttribute(
    "aria-valuenow",
    String(retainedStart),
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(trimEnd).toHaveAttribute("aria-valuenow", String(retainedEnd));
  await selectProjectAction(page, "Save project");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = JSON.parse(
          localStorage.getItem("test-saved-project") || "{}",
        );
        const t = p.tracks?.find(
          (t: { stream_index: number; asset_id: string }) =>
            p.assets
              ?.find((a: { id: string }) => a.id === t.asset_id)
              ?.streams?.some(
                (s: { index: number; kind: string }) =>
                  s.index === t.stream_index && s.kind === "video",
              ),
        );
        return [p.schema_version, t?.trim_start_ms, t?.trim_end_ms];
      }),
    )
    .toEqual([3, retainedStart, retainedEnd]);
  await trimStart.scrollIntoViewIfNeeded();
  handle = (await trimStart.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 15,
    handle.y + handle.height / 2,
    { steps: 4 },
  );
  await trimStart.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(trimStart).toHaveAttribute(
    "aria-valuenow",
    String(retainedStart),
  );
  handle = (await trimStart.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 40,
    handle.y + handle.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(trimStart).toHaveAttribute("aria-valuenow", "0");
  await trimEnd.scrollIntoViewIfNeeded();
  handle = (await trimEnd.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 45,
    handle.y + handle.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(trimEnd).toHaveAttribute("aria-valuenow", String(originalEnd));
  await trimStart.press("ArrowRight");
  await trimEnd.press("ArrowLeft");
  await trimStart.dblclick();
  await trimEnd.dblclick();
  await expect(trimStart).toHaveAttribute("aria-valuenow", "0");
  await expect(trimEnd).toHaveAttribute("aria-valuenow", String(originalEnd));
  await expect(videoLane.locator(".chapter-pin")).toHaveCount(1);
  for (const lane of await editor
    .locator(".timeline-lane:not(.lane-cover)")
    .all())
    await expect(lane.getByRole("slider")).toHaveCount(2);
  const musicClip = musicLane.locator(".timeline-clip");
  // Explicit fitting is one source-bounded undo step, shared by menu and modifier click.
  const videoOffsetField = videoLane.getByRole("spinbutton");
  const originalVideoOffset = await videoOffsetField.inputValue();
  await videoOffsetField.fill(String(1000 - originalEnd));
  await videoOffsetField.press("Enter");
  const musicEnd = musicLane.getByRole("slider", { name: /^Trim end/ });
  const originalMusicEnd = await musicEnd.getAttribute("aria-valuenow");
  await musicClip.focus();
  await musicClip.press("Shift+F10");
  const clipMenuItem = page.getByRole("menuitem", {
    name: "Clip to video",
    exact: true,
  });
  await expect(clipMenuItem).toBeEnabled();
  await page.keyboard.press("ArrowDown");
  await expect(clipMenuItem).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("clip-to-video-context-menu.png"),
  });
  await page.keyboard.press("Enter");
  await expect(musicEnd).toHaveAttribute("aria-valuenow", "1000");
  await expect(musicLane.getByRole("spinbutton")).toHaveValue("0");
  await expect(videoLane.locator(".chapter-pin")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(musicEnd).toHaveAttribute("aria-valuenow", originalMusicEnd!);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(musicEnd).toHaveAttribute("aria-valuenow", "1000");
  await musicClip.click({ button: "right" });
  await expect(clipMenuItem).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const fitSubtitleLane = editor.getByRole("article", {
    name: "subtitle timeline Alternate subtitles",
    exact: true,
  });
  const fitSubtitle = fitSubtitleLane.locator(".timeline-clip");
  const fitSubtitleEnd = fitSubtitleLane.getByRole("slider", {
    name: /^Trim end/,
  });
  const originalSubtitleEnd =
    await fitSubtitleEnd.getAttribute("aria-valuenow");
  await fitSubtitle.click({ modifiers: ["Control", "Alt"] });
  await expect(fitSubtitleEnd).toHaveAttribute("aria-valuenow", "1000");
  await expect(fitSubtitleLane.getByRole("spinbutton")).toHaveValue("0");
  await expect(videoLane.locator(".chapter-pin")).toHaveCount(1);
  await selectProjectAction(page, "Save project");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("test-saved-project") || "{}",
          ).tracks?.find(
            (t: { title: string }) => t.title === "Alternate subtitles",
          )?.trim_end_ms,
      ),
    )
    .toBe(1000);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(fitSubtitleEnd).toHaveAttribute(
    "aria-valuenow",
    originalSubtitleEnd!,
  );
  await musicLane.getByRole("spinbutton").fill("-2000");
  await musicLane.getByRole("spinbutton").press("Enter");
  await musicClip.click({ modifiers: ["Control", "Alt"] });
  await expect(musicEnd).toHaveAttribute("aria-valuenow", "3000");
  await expect(musicLane.getByRole("spinbutton")).toHaveValue("-2000");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(musicEnd).toHaveAttribute("aria-valuenow", originalMusicEnd!);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(musicLane.getByRole("spinbutton")).toHaveValue("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(videoOffsetField).toHaveValue(originalVideoOffset);
  await videoOffsetField.fill("-16667");
  await videoOffsetField.press("Enter");
  await musicEnd.scrollIntoViewIfNeeded();
  const snapScale = (
    await readTimelinePoint(musicLane.locator(".lane-viewport"), 0)
  ).scale;
  const snapBox = (await musicEnd.boundingBox())!;
  const snapX = snapBox.x + snapBox.width / 2 - 16667 * snapScale;
  const snapY = snapBox.y + snapBox.height / 2;
  await page.mouse.move(snapBox.x + snapBox.width / 2, snapY);
  await page.mouse.down();
  await page.mouse.move(snapX + 3, snapY, { steps: 8 });
  await expect(musicEnd).toHaveAttribute(
    "aria-valuenow",
    String(originalEnd - 16667),
  );
  await expect(musicEnd).toHaveClass(/snap-aligned/);
  await page.screenshot({
    path: testInfo.outputPath("trim-snapped-to-video.png"),
  });
  await page.mouse.move(snapX + 12, snapY);
  await expect(musicEnd).not.toHaveAttribute(
    "aria-valuenow",
    String(originalEnd - 16667),
  );
  await page.mouse.move(snapX - 3, snapY);
  await page.mouse.up();
  await expect(musicEnd).toHaveAttribute(
    "aria-valuenow",
    String(originalEnd - 16667),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(musicEnd).toHaveAttribute("aria-valuenow", originalMusicEnd!);
  await musicEnd.scrollIntoViewIfNeeded();
  const cancelBox = (await musicEnd.boundingBox())!;
  await page.mouse.move(
    cancelBox.x + cancelBox.width / 2,
    cancelBox.y + cancelBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    cancelBox.x + cancelBox.width / 2 - 16667 * snapScale + 3,
    cancelBox.y + cancelBox.height / 2,
    { steps: 8 },
  );
  await musicEnd.press("Escape");
  await page.mouse.up();
  await expect(musicEnd).toHaveAttribute("aria-valuenow", originalMusicEnd!);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(videoOffsetField).toHaveValue(originalVideoOffset);
  await expect(
    editor.getByRole("checkbox", { name: /^Timeline include/ }),
  ).toHaveCount(0);
  await musicClip.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Exclude", exact: true }).click();
  await expect(musicClip.getByText("Excluded", { exact: true })).toBeVisible();
  await expect(musicLane).toHaveClass(/excluded/);
  await musicClip.focus();
  await musicClip.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Include", exact: true }).click();
  await expect(musicClip.getByText("Excluded", { exact: true })).toHaveCount(0);
  await musicClip.scrollIntoViewIfNeeded();
  const musicBox = (await musicClip.boundingBox())!;
  await page.mouse.move(musicBox.x + musicBox.width / 2, musicBox.y + 34);
  await page.mouse.down();
  await page.mouse.move(musicBox.x + musicBox.width / 2 + 40, musicBox.y + 34, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await musicLane.getByRole("spinbutton").inputValue()),
    )
    .toBeGreaterThan(0);
  await musicLane
    .getByRole("button", { name: "Mute Music", exact: true })
    .click();
  await expect(
    musicLane.getByRole("button", { name: "Unmute Music", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const subtitleLane = editor.getByRole("article", {
    name: "subtitle timeline Alternate subtitles",
    exact: true,
  });
  const subClip = subtitleLane.locator(".timeline-clip");
  await subClip.scrollIntoViewIfNeeded();
  const subBox = (await subClip.boundingBox())!;
  await page.mouse.move(subBox.x + subBox.width / 2, subBox.y + 34);
  await page.mouse.down();
  await page.mouse.move(subBox.x + subBox.width / 2 - 32, subBox.y + 34, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await subtitleLane.getByRole("spinbutton").inputValue()),
    )
    .toBeLessThan(0);
  await subtitleLane.getByRole("spinbutton").fill("-100");
  await videoLane
    .locator(".timeline-clip")
    .click({ position: { x: 40, y: 25 } });
  await expect(videoLane.locator(".chapter-pin")).toHaveCount(2);
  await videoLane
    .getByRole("button", { name: "Chapter marker Chapter 2", exact: true })
    .press("ArrowRight");
  await musicClip.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Exclude", exact: true }).click();
  await selectProjectAction(page, "Save project");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = JSON.parse(
          localStorage.getItem("test-saved-project") || "{}",
        );
        return p.tracks?.find((t: { title: string }) => t.title === "French")
          ?.audio_role;
      }),
    )
    .toBe("separate");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = JSON.parse(
          localStorage.getItem("test-saved-project") || "{}",
        );
        return p.tracks?.find((t: { title: string }) => t.title === "Music")
          ?.muted;
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("test-saved-project") || "{}",
          ).tracks?.find((t: { title: string }) => t.title === "Music")
            ?.enabled,
      ),
    )
    .toBe(false);
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Project poster / cover", exact: true }),
  ).toBeVisible();
  const seek = page.getByRole("slider", {
    name: "Preview seek bar",
    exact: true,
  });
  await expect(seek).toBeVisible();
  await expect(seek).toBeEnabled();
  const volume = page.getByRole("slider", {
    name: "Preview volume",
    exact: true,
  });
  await expect(volume).toHaveValue("0.05");
  expect((await volume.boundingBox())!.width).toBeGreaterThanOrEqual(120);
  await expect
    .poll(() =>
      page
        .getByLabel("Source media preview", { exact: true })
        .evaluate((el) => (el as HTMLVideoElement).volume),
    )
    .toBe(0.05);
  await page
    .getByLabel("Source media preview", { exact: true })
    .evaluate((element) =>
      Object.defineProperty(element, "seeking", {
        configurable: true,
        get: () => true,
      }),
    );
  const dragBar = (await seek.boundingBox())!;
  await page.mouse.move(
    dragBar.x + dragBar.width * 0.6,
    dragBar.y + dragBar.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragBar.x + dragBar.width * 0.2,
    dragBar.y + dragBar.height / 2,
    { steps: 12 },
  );
  expect(Number(await seek.inputValue())).toBeGreaterThan(15000);
  expect(Number(await seek.inputValue())).toBeLessThan(35000);
  await page.mouse.up();
  await expect
    .poll(() =>
      page
        .getByLabel("Source media preview", { exact: true })
        .evaluate((el) => (el as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(15);
  await expect
    .poll(() =>
      page
        .getByLabel("Source media preview", { exact: true })
        .evaluate((el) => (el as HTMLVideoElement).currentTime),
    )
    .toBeLessThan(35);
  await expect
    .poll(async () =>
      Math.abs(
        Number(
          await videoLane.locator(".lane-playhead").getAttribute("data-time"),
        ) - Number(await seek.inputValue()),
      ),
    )
    .toBeLessThan(50);
  await page
    .getByLabel("Source media preview", { exact: true })
    .evaluate((element) => {
      delete (element as unknown as { seeking?: boolean }).seeking;
    });
  expect(
    await videoLane
      .locator(".lane-playhead")
      .evaluate((el) => Number(getComputedStyle(el).zIndex)),
  ).toBeGreaterThan(12);
  await videoViewport.hover();
  await page.keyboard.down("Alt");
  await page.mouse.wheel(0, -600);
  await page.keyboard.up("Alt");
  await page.keyboard.down("Control");
  const seekBox = (await seek.boundingBox())!;
  await seek.click({
    position: { x: seekBox.width * 0.65, y: seekBox.height / 2 },
  });
  await page.keyboard.up("Control");
  await expect
    .poll(() =>
      page
        .getByLabel("Source media preview", { exact: true })
        .evaluate((el) => (el as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(70);
  await expect
    .poll(async () => {
      const positions = await editor
        .locator(".lane-playhead")
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.left));
      return new Set(positions).size;
    })
    .toBe(1);
  await expect
    .poll(() => videoViewport.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  for (const lane of await editor.locator(".lane-viewport").all())
    await expect
      .poll(() => lane.evaluate((el) => el.scrollLeft))
      .toBeCloseTo(await videoViewport.evaluate((el) => el.scrollLeft), 0);
  await editor.getByRole("button", { name: /%$/ }).click();
  const divider = page.getByRole("separator", { name: "Resize media pool" });
  if (testInfo.project.name === "desktop") {
    const previous = Number(await divider.getAttribute("aria-valuenow"));
    const dividerBox = (await divider.boundingBox())!;
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2,
      dividerBox.y + 50,
    );
    await page.mouse.down();
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2 + 50,
      dividerBox.y + 50,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect
      .poll(() => divider.getAttribute("aria-valuenow").then(Number))
      .not.toBe(previous);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number(localStorage.getItem("reelio.media-pool-width.v1")),
        ),
      )
      .toBeGreaterThan(previous);
  }
  await page.screenshot({
    path: testInfo.outputPath("timeline-workspace.png"),
    fullPage: true,
  });
  // Leave an explicit unsaved edit for the discard-protection checks below.
  await videoLane
    .getByRole("button", { name: "Chapter marker Chapter 2", exact: true })
    .press("ArrowRight");
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            cmd: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke;
    let repaired = false;
    internals.invoke = async (cmd, args) => {
      if (cmd === "dependencies_repair") {
        repaired = true;
        localStorage.setItem("test-repair-requested", "true");
        return original(cmd, args);
      }
      if (cmd === "dependencies_status" && !repaired)
        return {
          preview_available: false,
          network_available: true,
          backend_available: true,
          missing_components: ["GStreamer: autoaudiosink"],
          repair_supported: true,
          repair_hint: "Install required playback components",
          packages: ["gst-plugins-good"],
        };
      return original(cmd, args);
    };
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Check required components", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Required components need attention"),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("test-repair-requested")),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Install required components", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("test-repair-requested")),
    )
    .toBe("true");
  await expect(
    page.getByText("Required components need attention"),
  ).toHaveCount(0);
  const previewRequests = await page.evaluate(() =>
    Number(localStorage.getItem("test-preview-requests") || 0),
  );
  await page
    .getByRole("button", { name: "Retry preview", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(localStorage.getItem("test-preview-requests") || 0),
      ),
    )
    .toBeGreaterThan(previewRequests);
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Unsaved window-close regression");
  const currentName = await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .inputValue();
  page.once("dialog", (dialog) => dialog.dismiss());
  await windowButtons.getByRole("button", { name: "Close window" }).click();
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue(currentName);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("test-window-actions") || "[]").includes(
        "close",
      ),
    ),
  ).toBe(false);
  // Chapter deletion is separate from lane removal, and both are single undo steps.
  const markers = videoLane.locator(".chapter-pin");
  const markerCount = await markers.count();
  expect(markerCount).toBeGreaterThan(0);
  await markers.first().click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Chapter marker actions" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(markers).toHaveCount(markerCount - 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(markers).toHaveCount(markerCount);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(markers).toHaveCount(markerCount - 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const frenchId = await frenchLane.getAttribute("data-track-id");
  await frenchLane.locator(".timeline-clip").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect(frenchLane).toHaveCount(0);
  if (
    await page
      .getByRole("button", { name: "Expand left sidebar", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Expand left sidebar", exact: true })
      .click();
  await expect(
    page.locator('.pool-add[aria-label="Add French.m4a to timeline"]'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frenchLane).toHaveAttribute("data-track-id", frenchId!);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(frenchLane).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add French.m4a to timeline", exact: true })
    .click();
  await expect(frenchLane).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frenchLane).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(frenchLane).toHaveAttribute("data-track-id", frenchId!);

  const coverTarget = page.getByRole("button", {
    name: "Edit project cover",
    exact: true,
  });
  const videoCount = await editor.locator(".lane-video").count();
  async function nativeCoverDrop(path: string) {
    await coverTarget.scrollIntoViewIfNeeded();
    const rect = (await coverTarget.boundingBox())!;
    await page.evaluate(
      ({ path, x, y }) => {
        (
          window as unknown as { __reelioDrop: (payload: unknown) => void }
        ).__reelioDrop({
          paths: [path],
          position: { x, y },
          viewport: { width: innerWidth, height: innerHeight },
        });
      },
      { path, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    );
  }
  await nativeCoverDrop("/media/Cover.avif");
  await expect(
    page
      .locator(".pool-asset")
      .filter({ hasText: "Cover.avif" })
      .getByText("IMAGE", { exact: true }),
  ).toBeVisible();
  await expect(editor.locator(".lane-video")).toHaveCount(videoCount);
  await expect(
    page.getByRole("option", { name: "Cover.avif", exact: true }),
  ).toHaveCount(0);
  const coverLane = editor.getByRole("article", {
    name: "cover timeline",
    exact: true,
  });
  await expect(coverLane).toHaveCount(1);
  await expect(coverLane.getByRole("slider")).toHaveCount(0);
  await expect(coverLane.getByText("C", { exact: true })).toBeVisible();
  await coverTarget.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Poster & cover", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await coverLane.getByText("Cover", { exact: true }).dblclick();
  await expect(
    page.getByRole("tab", { name: "Poster & cover", exact: true }),
  ).toHaveAttribute("data-state", "active");
  const coverFilter = page.getByRole("button", {
    name: "Black and white",
    exact: true,
  });
  await coverFilter.click();
  await expect(coverFilter).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await coverLane
    .getByRole("img", { name: "Cover thumbnail", exact: true })
    .dblclick();
  await expect(
    page.getByRole("tab", { name: "Poster & cover", exact: true }),
  ).toHaveAttribute("data-state", "active");
  await expect(coverFilter).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await coverLane.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect(coverLane).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(coverLane).toHaveCount(1);
  await nativeCoverDrop("/media/Film.mkv");
  await expect(page.getByText(/Drop a still image, not a video/)).toBeVisible();
  await expect(
    coverLane.getByRole("button", { name: "Project cover", exact: true }),
  ).toContainText("Cover.avif");
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Saved cover fixture");
  await selectProjectAction(page, "Save project");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-saved-project") || "{}").artwork
            ?.source_label,
      ),
    )
    .toBe("Cover.avif");
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("test-saved-project") || "{}",
      ).tracks.some(
        (track: { asset_id: string }) => track.asset_id === "cover-image",
      ),
    ),
  ).toBe(false);
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill(currentName);
  await page.screenshot({
    path: testInfo.outputPath("cover-lane-and-image-resource.png"),
  });
  expect(runtimeErrors).toEqual([]);
  const newProject = page.getByRole("menuitem", {
    name: "New project",
    exact: true,
  });
  const openProject = page.getByRole("menuitem", {
    name: "Open project",
    exact: true,
  });
  await openProjectMenu(page);
  await expect(newProject).toHaveAttribute("title", "New project (Ctrl/Cmd+N)");
  page.once("dialog", (dialog) => dialog.dismiss());
  await newProject.click();
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue(currentName);
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Control+n");
  await expect(
    page.getByRole("heading", {
      name: "No media in this project",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Cropped Long audio \[audio-id\]/)).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("tab", { name: "Export & history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "MP4", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Output profile", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Timeline", exact: true }).click();
  await openProjectMenu(page);
  await expect(
    page.getByRole("menuitem", { name: "Save project", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("new-project.png"),
    fullPage: true,
  });
  const existingSavedProject = await page.evaluate(() =>
    localStorage.getItem("test-saved-project"),
  );
  await selectProjectAction(page, "Save project");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("test-saved-project") || "{}").assets
            ?.length,
      ),
    )
    .toBe(0);
  await page.evaluate(
    (saved) => localStorage.setItem("test-saved-project", saved!),
    existingSavedProject,
  );
  await openProjectMenu(page);
  await openProject.click();
  const savedName = await page.evaluate(
    () => JSON.parse(localStorage.getItem("test-saved-project") || "{}").name,
  );
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue(savedName);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    localStorage.setItem("test-project-open-mode", "cancel"),
  );
  await page.keyboard.press("Control+Shift+o");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(localStorage.getItem("test-project-opens") || 0),
      ),
    )
    .toBe(2);
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue(savedName);
  await page.evaluate(() =>
    localStorage.setItem("test-project-open-mode", "fail"),
  );
  await openProjectMenu(page);
  await openProject.click();
  await expect(page.getByRole("alert")).toContainText(
    "Project could not be opened",
  );
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue(savedName);
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Unsaved project name");
  page.once("dialog", (dialog) => dialog.dismiss());
  await openProjectMenu(page);
  await openProject.click();
  expect(
    await page.evaluate(() =>
      Number(localStorage.getItem("test-project-opens") || 0),
    ),
  ).toBe(3);
  await page.evaluate(() =>
    localStorage.setItem("test-project-open-mode", "cancel"),
  );
  page.once("dialog", (dialog) => dialog.accept());
  await openProjectMenu(page);
  await openProject.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(localStorage.getItem("test-project-opens") || 0),
      ),
    )
    .toBe(4);
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue("Unsaved project name");
  await page.evaluate(() => localStorage.removeItem("test-project-open-mode"));
  page.once("dialog", (dialog) => dialog.accept());
  await openProjectMenu(page);
  await openProject.click();
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveValue(savedName);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    wide: Array.from(document.querySelectorAll("*"))
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .map((el) => ({
        tag: el.tagName,
        cls: String(el.className),
        right: el.getBoundingClientRect().right,
        overflow: getComputedStyle(el).overflowX,
      }))
      .slice(0, 35),
  }));
  expect(layout.scroll, JSON.stringify(layout.wide)).toBeLessThanOrEqual(
    layout.width,
  );
});
