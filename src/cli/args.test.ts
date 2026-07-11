import { describe, expect, it } from "vitest";
import { CliUsageError, parseCliArguments } from "./args";

describe("CLI argument parser", () => {
  it("supports root help/version and test help", () => {
    expect(parseCliArguments([])).toEqual({ kind: "help", topic: "root" });
    expect(parseCliArguments(["-h"])).toEqual({ kind: "help", topic: "root" });
    expect(parseCliArguments(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArguments(["test", "--help"])).toEqual({ kind: "help", topic: "test" });
  });

  it("parses every release flag and equals syntax", () => {
    expect(
      parseCliArguments([
        "test",
        "boundary.yaml",
        "--target=https://rag.example.test/v1",
        "--format",
        "sarif",
        "--output",
        "results.sarif",
        "--fail-on=critical",
        "--timeout",
        "45000",
        "--concurrency=8",
        "--dry-run",
      ]),
    ).toEqual({
      kind: "test",
      file: "boundary.yaml",
      target: "https://rag.example.test/v1",
      format: "sarif",
      output: "results.sarif",
      failOn: "critical",
      timeoutMs: 45_000,
      concurrency: 8,
      dryRun: true,
    });
  });

  it("rejects duplicates, missing values, and out-of-range numerics", () => {
    expect(() =>
      parseCliArguments(["test", "a.yaml", "--timeout", "99"]),
    ).toThrowError(CliUsageError);
    expect(() =>
      parseCliArguments(["test", "a.yaml", "--format", "json", "--format=json"]),
    ).toThrowError(/more than once/);
    expect(() =>
      parseCliArguments(["test", "a.yaml", "--target", "--dry-run"]),
    ).toThrowError(/requires a value/);
  });
});

