import { test, expect } from "@playwright/test";
test("icon transport steps, stops, jumps, inserts timeline chapters and selects every speed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).webkit = {
      messageHandlers: { result: { postMessage: () => {} } },
    };
  });
  await page.goto("/native-tests/transport.html");
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    let time = 1,
      paused = true;
    Object.defineProperties(video, {
      error: { configurable: true, get: () => null },
      readyState: { configurable: true, get: () => 4 },
      duration: { configurable: true, get: () => 8 },
      seeking: { configurable: true, get: () => false },
      paused: { configurable: true, get: () => paused },
      currentTime: {
        configurable: true,
        get: () => time,
        set: (value) => {
          time = value;
          video.dispatchEvent(new Event("timeupdate"));
        },
      },
    });
    video.pause = () => {
      paused = true;
      video.dispatchEvent(new Event("pause"));
    };
    video.play = () => {
      paused = false;
      video.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(button("Next frame")).toBeEnabled();
  await expect(button("Next frame")).toHaveAttribute("title", /Next frame/);
  await button("Next frame").click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(1.04);
  await button("Add chapter marker at playhead").click();
  await expect(page.locator("#chapter-marker")).toHaveText("2240");
  await button("Previous frame").click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(1);
  await page.evaluate(() =>
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space")
        localStorage.setItem("transport-space-bubbled", "yes");
    }),
  );
  await button("Previous frame").press("Space");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(0.96);
  expect(
    await page.evaluate(() => localStorage.getItem("transport-space-bubbled")),
  ).toBeNull();
  await button("Play preview").click();
  await expect(button("Pause preview")).toBeVisible();
  await button("Stop preview").click();
  await expect(button("Play preview")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBe(0);
  await button("Skip to end").click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBe(8);
  await button("Skip to beginning").click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBe(0);
  const speed = page.getByRole("slider", { name: "Preview playback speed" });
  await speed.focus();
  await speed.press("Home");
  for (const [index, rate] of [
    0.1, 0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 10,
  ].entries()) {
    if (index) await speed.press("ArrowRight");
    await expect(speed).toHaveAttribute("aria-valuetext", `${rate}x`);
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.playbackRate),
      )
      .toBe(rate);
  }
});
