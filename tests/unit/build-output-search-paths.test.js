import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("build output search paths", () => {
  it("includes macOS universal bundle subdirectories", () => {
    const runnerPath = path.join(process.cwd(), "tests", "index.js");
    const runnerSource = fs.readFileSync(runnerPath, "utf8");

    expect(runnerSource).toContain(
      "src-tauri/target/universal-apple-darwin/release/bundle/macos",
    );
    expect(runnerSource).toContain(
      "src-tauri/target/universal-apple-darwin/release/bundle/dmg",
    );
  });
});
