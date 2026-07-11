/// <reference types="node" />

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());
const resolver = resolve(projectRoot, "scripts/resolve-action-path.mjs");
const actionRunner = resolve(projectRoot, "scripts/run-action.sh");
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "contextfence-action-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runResolver(
  mode: "directory" | "file" | "output",
  workspace: string,
  base: string,
  path: string,
) {
  return spawnSync(process.execPath, [resolver, mode, workspace, base, path], {
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("GitHub Action workspace path confinement", () => {
  it("resolves ordinary contracts and creates nested report parents inside the workspace", () => {
    const workspace = temporaryDirectory();
    const project = join(workspace, "project");
    mkdirSync(project);
    const contract = join(project, "boundary.yaml");
    writeFileSync(contract, "version: 1\n");

    const resolvedContract = runResolver("file", workspace, project, "boundary.yaml");
    expect(resolvedContract.status).toBe(0);
    expect(resolvedContract.stdout).toBe(realpathSync(contract));

    const resolvedOutput = runResolver(
      "output",
      workspace,
      project,
      "reports/security/contextfence.sarif",
    );
    expect(resolvedOutput.status).toBe(0);
    expect(resolvedOutput.stdout).toBe(
      join(realpathSync(project), "reports/security/contextfence.sarif"),
    );
    expect(existsSync(join(project, "reports/security"))).toBe(true);
  });

  it("rejects lexical escapes before creating an output directory", () => {
    const parent = temporaryDirectory();
    const workspace = join(parent, "workspace");
    mkdirSync(workspace);
    const result = runResolver(
      "output",
      workspace,
      workspace,
      "../escaped/report.json",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lexically escapes");
    expect(existsSync(join(parent, "escaped"))).toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "rejects contract and output symlinks that leave the workspace",
    () => {
      const parent = temporaryDirectory();
      const workspace = join(parent, "workspace");
      const outside = join(parent, "outside");
      mkdirSync(workspace);
      mkdirSync(outside);
      writeFileSync(join(outside, "boundary.yaml"), "version: 1\n");
      symlinkSync(join(outside, "boundary.yaml"), join(workspace, "boundary.yaml"));
      symlinkSync(outside, join(workspace, "reports"));

      const contract = runResolver(
        "file",
        workspace,
        workspace,
        "boundary.yaml",
      );
      expect(contract.status).toBe(1);
      expect(contract.stderr).toContain("symlink outside");

      const output = runResolver(
        "output",
        workspace,
        workspace,
        "reports/result.json",
      );
      expect(output.status).toBe(1);
      expect(output.stderr).toContain("outside the workspace");
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects control characters before emitting workflow commands",
    () => {
      const workspace = temporaryDirectory();
      const result = spawnSync("bash", [actionRunner], {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTION_PATH: projectRoot,
          GITHUB_OUTPUT: join(workspace, "github-output"),
          GITHUB_WORKSPACE: workspace,
          INPUT_CONCURRENCY: "1",
          INPUT_CONTRACT: "boundary.yaml\n::error::injected",
          INPUT_DRY_RUN: "true",
          INPUT_FAIL_ON: "low",
          INPUT_FORMAT: "json",
          INPUT_OUTPUT: "report.json",
          INPUT_TARGET: "",
          INPUT_TIMEOUT: "100",
          INPUT_VERSION: "0.1.0",
          INPUT_WORKING_DIRECTORY: ".",
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("must not contain control characters");
      expect(result.stderr).not.toContain("command not found");
    },
  );
});
