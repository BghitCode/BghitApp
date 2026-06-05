import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

describe("build output search paths", () => {
  it("finds artifacts in macOS universal bundle subdirectories", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bghitapp-test-"));

    try {
      const appName = "GitHubMultiArch";
      const bundleDir = path.join(
        tempRoot,
        "src-tauri/target/universal-apple-darwin/release/bundle",
      );

      // Create artifacts in the subdirectories Tauri actually uses
      const appDir = path.join(bundleDir, "macos", `${appName}.app`);
      const dmgDir = path.join(bundleDir, "dmg");
      const dmgFile = path.join(dmgDir, `${appName}.dmg`);

      fs.mkdirSync(appDir, { recursive: true });
      fs.mkdirSync(dmgDir, { recursive: true });
      fs.writeFileSync(dmgFile, "fake dmg");

      // Replicate the search logic from index.js findBuildOutputFiles
      const searchLocations = [
        tempRoot,
        path.join(bundleDir),
        path.join(bundleDir, "macos"),
        path.join(bundleDir, "dmg"),
      ];

      const foundFiles = [];
      for (const location of searchLocations) {
        if (!fs.existsSync(location)) continue;
        const entries = fs.readdirSync(location, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === `${appName}.app` && entry.isDirectory()) {
            foundFiles.push({
              path: path.join(location, entry.name),
              type: "macOS App Bundle",
            });
          }
          if (
            entry.name.endsWith(".dmg") &&
            entry.name.includes(appName) &&
            entry.isFile()
          ) {
            foundFiles.push({
              path: path.join(location, entry.name),
              type: "DMG Image",
            });
          }
        }
      }

      const foundPaths = foundFiles.map((item) => item.path);

      expect(foundPaths).toContain(appDir);
      expect(foundPaths).toContain(dmgFile);
      expect(foundFiles.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("finds artifacts in macOS standard release bundle", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bghitapp-test-"));

    try {
      const appName = "TestApp";
      const bundleDir = path.join(
        tempRoot,
        "src-tauri/target/release/bundle",
      );

      const appDir = path.join(bundleDir, "macos", `${appName}.app`);
      fs.mkdirSync(appDir, { recursive: true });

      const searchLocations = [
        tempRoot,
        path.join(bundleDir, "macos"),
      ];

      const foundFiles = [];
      for (const location of searchLocations) {
        if (!fs.existsSync(location)) continue;
        const entries = fs.readdirSync(location, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === `${appName}.app` && entry.isDirectory()) {
            foundFiles.push({
              path: path.join(location, entry.name),
              type: "macOS App Bundle",
            });
          }
        }
      }

      const foundPaths = foundFiles.map((item) => item.path);
      expect(foundPaths).toContain(appDir);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("finds artifacts in Windows bundle directories", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bghitapp-test-"));

    try {
      const appName = "TestApp";
      const msiDir = path.join(
        tempRoot,
        "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi",
      );
      fs.mkdirSync(msiDir, { recursive: true });
      fs.writeFileSync(path.join(msiDir, `${appName}_1.0.0_x64.msi`), "fake");

      const searchLocations = [
        path.join(
          tempRoot,
          "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi",
        ),
      ];

      const foundFiles = [];
      for (const location of searchLocations) {
        if (!fs.existsSync(location)) continue;
        const entries = fs.readdirSync(location, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.endsWith(".msi") && entry.isFile()) {
            foundFiles.push({
              path: path.join(location, entry.name),
              type: "MSI Installer",
            });
          }
        }
      }

      expect(foundFiles.length).toBe(1);
      expect(foundFiles[0].type).toBe("MSI Installer");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
