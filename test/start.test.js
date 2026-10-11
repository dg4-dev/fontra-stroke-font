import assert from "node:assert/strict";
import { test } from "node:test";

import { start } from "../src/start.js";

test("start is the function named in plugin.json", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(
    await readFile(new URL("../plugin.json", import.meta.url), "utf-8")
  );
  assert.equal(manifest.init, "src/start.js");
  assert.equal(manifest.function, "start");
  assert.equal(typeof start, "function");
});
