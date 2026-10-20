import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let sequence = 0,
      polls = 0;
    const callbacks = new Map<number, unknown>();
    const fixture = {
      cues: [
        { id: "a", start_ms: 1000, end_ms: 3000, text: "Hello world" },
        { id: "b", start_ms: 4000, end_ms: 6000, text: "Second subtitle" },
      ],
    };
    let job: any = {
        id: "",
        kind: "",
        status: "",
        done: 0,
        total: 0,
        message: "",
      },
      snapshot: any,
      results: any[] = [];
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        transformCallback: (fn: unknown) => {
          const id = ++sequence;
          callbacks.set(id, fn);
          return id;
        },
        unregisterCallback: (id: number) => callbacks.delete(id),
        invoke: async (cmd: string, args: any = {}) => {
          if (cmd === "plugin:event|listen") return ++sequence;
          if (cmd === "plugin:event|unlisten") return;
          if (cmd === "subtitle_editor_dirty") {
            localStorage.setItem("subtitle-test-dirty", "yes");
            return;
          }
          if (cmd === "subtitle_editor_draft") {
            if (args.clear) {
              localStorage.removeItem("subtitle-test-draft");
              return null;
            }
            if (args.document)
              localStorage.setItem(
                "subtitle-test-draft",
                JSON.stringify(args.document),
              );
            return JSON.parse(
              localStorage.getItem("subtitle-test-draft") || "null",
            );
          }
          if (cmd === "subtitle_editor_open")
            return {
              document: structuredClone(fixture),
              path: "/media/original.srt",
            };
          if (cmd === "subtitle_editor_save") {
            if (localStorage.getItem("subtitle-test-save-failure"))
              throw Error(
                "Destination exists. Original files were not overwritten.",
              );
            localStorage.setItem(
              "subtitle-test-saved",
              JSON.stringify(args.document),
            );
            return "/media/edited-copy.srt";
          }
          if (cmd === "subtitle_models")
            return {
              installed: [{ name: "gemma3:4b", bytes: 3350272403 }],
              supported: ["gemma3:4b"],
            };
          if (cmd === "subtitle_model_start") {
            snapshot = structuredClone(args.document);
            polls = 0;
            job = {
              id: "translation-fixture",
              kind: args.document ? "translate" : "pull",
              status: "running",
              done: 0,
              total: args.document?.cues.length || 100,
              message: "Running local fixture",
            };
            results = args.document
              ? args.document.cues.map((c: any) => ({
                  id: c.id,
                  text: `Translated: ${c.text}`,
                }))
              : [];
            return { ...job };
          }
          if (cmd === "subtitle_model_status") {
            if (
              job.status === "running" &&
              !localStorage.getItem("subtitle-test-hold") &&
              ++polls >= 2
            )
              job = {
                ...job,
                status: "completed",
                done: job.total,
                message: "Completed; review before applying",
              };
            return { ...job };
          }
          if (cmd === "subtitle_model_cancel") {
            job = {
              ...job,
              status: "cancelled",
              done: 0,
              message: "Cancelled",
            };
            return;
          }
          if (cmd === "subtitle_model_results")
            return {
              document: {
                cues: snapshot.cues.map((c: any) => ({
                  end_ms: c.end_ms,
                  id: c.id,
                  text: c.text,
                  start_ms: c.start_ms,
                })),
              },
              translations: results,
            };
          throw Error(`Unexpected test command ${cmd}`);
        },
      },
    });
  });
  await page.goto("/native-tests/subtitles.html");
  await page
    .getByRole("button", { name: "Open subtitle editor", exact: true })
    .click();
});
test("SRT editing creates, splits, merges, undoes, saves a copy and recovers drafts", async ({
  page,
}) => {
  const editor = page.getByRole("dialog", {
    name: "SRT subtitle editor",
    exact: true,
  });
  await editor.getByRole("button", { name: "New SRT", exact: true }).click();
  const text = editor.getByRole("textbox", {
    name: "Subtitle cue text",
    exact: true,
  });
  await text.fill("Hello world");
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 5));
  await editor
    .getByRole("button", { name: "Split at text cursor", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Edit cue 2", exact: true }),
  ).toBeVisible();
  await expect(text).toHaveValue("Hello");
  await editor
    .getByRole("button", { name: "Merge with next", exact: true })
    .click();
  await expect(text).toHaveValue("Hello\nworld");
  await editor
    .getByRole("button", { name: "Undo subtitle edit", exact: true })
    .click();
  await expect(text).toHaveValue("Hello");
  await editor
    .getByRole("button", { name: "Redo subtitle edit", exact: true })
    .click();
  await expect(text).toHaveValue("Hello\nworld");
  await editor.getByText("Timing, find & replace", { exact: true }).click();
  await editor.getByLabel("Shift milliseconds", { exact: true }).fill("1000");
  await editor
    .getByRole("button", { name: "Shift timing", exact: true })
    .click();
  await expect(
    editor.getByRole("textbox", { name: "Cue start time", exact: true }),
  ).toHaveValue("00:00:01,000");
  await editor.getByLabel("Find text", { exact: true }).fill("world");
  await editor.getByLabel("Replace with", { exact: true }).fill("subtitles");
  await editor
    .getByRole("button", { name: "Replace text", exact: true })
    .click();
  await expect(text).toHaveValue("Hello\nsubtitles");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("subtitle-test-draft") || "{}")
            .cues?.[0]?.text,
      ),
    )
    .toBe("Hello\nsubtitles");
  await page.reload();
  await page
    .getByRole("button", { name: "Open subtitle editor", exact: true })
    .click();
  await expect(text).toHaveValue("Hello\nsubtitles");
  await expect(
    editor.getByText(/Recovered an unsaved subtitle draft/),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Save SRT copy", exact: true })
    .click();
  await expect(editor.getByText(/Saved SRT copy:/)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("subtitle-test-saved") || "{}").cues[0],
    ),
  ).toMatchObject({ start_ms: 1000, end_ms: 3000, text: "Hello\nsubtitles" });
  await editor
    .getByRole("button", { name: "Add saved SRT to project", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("subtitle-test-added") || "[]"),
    ),
  ).toEqual(["/media/edited-copy.srt"]);
  await editor
    .getByRole("button", { name: "Close editor", exact: true })
    .click();
  await expect(editor).toBeHidden();
});
test("translation is reviewed before applying and preserves times with undo", async ({
  page,
}) => {
  const editor = page.getByRole("dialog", {
    name: "SRT subtitle editor",
    exact: true,
  });
  await editor.getByRole("button", { name: "Open SRT", exact: true }).click();
  const text = editor.getByRole("textbox", {
    name: "Subtitle cue text",
    exact: true,
  });
  await expect(text).toHaveValue("Hello world");
  await editor
    .getByRole("button", { name: "Refresh local models", exact: true })
    .click();
  await expect(
    editor.getByRole("option", { name: "gemma3:4b (installed)", exact: true }),
  ).toHaveCount(1);
  await editor.getByLabel("Translate into", { exact: true }).fill("French");
  await editor
    .getByRole("button", { name: "Translate document", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Review translated cues", exact: true }),
  ).toBeVisible();
  await expect(text).toHaveValue("Hello world");
  await editor
    .getByRole("button", { name: "Review translated cues", exact: true })
    .click();
  await expect(
    editor.getByRole("region", { name: "Translation review", exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("checkbox", { name: "Accept translation 2", exact: true })
    .uncheck();
  await editor
    .getByRole("button", { name: "Apply selected translations", exact: true })
    .click();
  await expect(text).toHaveValue("Translated: Hello world");
  await expect(
    editor.getByRole("textbox", { name: "Cue start time", exact: true }),
  ).toHaveValue("00:00:01,000");
  await expect(
    editor.getByRole("textbox", { name: "Cue end time", exact: true }),
  ).toHaveValue("00:00:03,000");
  await editor.getByRole("button", { name: "Edit cue 2", exact: true }).click();
  await expect(text).toHaveValue("Second subtitle");
  await editor
    .getByRole("button", { name: "Undo subtitle edit", exact: true })
    .click();
  await editor.getByRole("button", { name: "Edit cue 1", exact: true }).click();
  await expect(text).toHaveValue("Hello world");
  await page.evaluate(() => localStorage.setItem("subtitle-test-hold", "yes"));
  await editor
    .getByRole("button", { name: "Translate document", exact: true })
    .click();
  await expect(text).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Close editor", exact: true }),
  ).toBeDisabled();
  await editor
    .getByRole("button", { name: "Cancel model operation", exact: true })
    .click();
  await expect(text).toBeEnabled();
  await expect(editor.getByText(/translate: cancelled/)).toBeVisible();
});
test("existing destinations and discarded drafts do not lose original text", async ({
  page,
}) => {
  const editor = page.getByRole("dialog", {
    name: "SRT subtitle editor",
    exact: true,
  });
  await editor.getByRole("button", { name: "Open SRT", exact: true }).click();
  const text = editor.getByRole("textbox", {
    name: "Subtitle cue text",
    exact: true,
  });
  await text.fill("Edited draft");
  await page.evaluate(() =>
    localStorage.setItem("subtitle-test-save-failure", "yes"),
  );
  await editor
    .getByRole("button", { name: "Save SRT copy", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText(
    "Original files were not overwritten",
  );
  await expect(text).toHaveValue("Edited draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await editor
    .getByRole("button", { name: "Close editor", exact: true })
    .click();
  await expect(editor).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await editor
    .getByRole("button", { name: "Close editor", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await page
    .getByRole("button", { name: "Open subtitle editor", exact: true })
    .click();
  await expect(text).toHaveValue("Hello world");
});
