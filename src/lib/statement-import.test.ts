import { describe, expect, it } from "vitest";
import { money } from "./money";
import {
  type MatchCandidate,
  mapHeaders,
  matchLines,
  parseAmount,
  parseCsv,
  parseStatement,
} from "./statement-import";

describe("parseCsv", () => {
  it("reads a simple file", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    const rows = parseCsv('ref,caption\nBG-1,"Avery Hart, New York"');
    expect(rows[1]).toEqual(["BG-1", "Avery Hart, New York"]);
  });

  it("handles escaped quotes", () => {
    const rows = parseCsv('ref,caption\nBG-1,"She said ""no"" on the steps"');
    expect(rows[1][1]).toBe('She said "no" on the steps');
  });

  it("handles a newline inside a quoted field", () => {
    const rows = parseCsv('ref,caption\nBG-1,"line one\nline two"');
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe("line one\nline two");
  });

  it("tolerates CRLF endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a byte order mark", () => {
    expect(parseCsv("﻿ref,amount\nBG-1,100")[0][0]).toBe("ref");
  });

  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toHaveLength(2);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("mapHeaders", () => {
  it("recognises common names", () => {
    const mapping = mapHeaders(["Reference", "Description", "Gross", "Commission", "Net"]);
    expect(mapping.reference).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.gross).toBe(2);
    expect(mapping.deductions).toBe(3);
    expect(mapping.net).toBe(4);
  });

  it("is case and separator insensitive", () => {
    const mapping = mapHeaders(["IMAGE_ID", "sale amount", "agency fee"]);
    expect(mapping.reference).toBe(0);
    expect(mapping.gross).toBe(1);
    expect(mapping.deductions).toBe(2);
  });

  it("leaves unknown columns unmapped", () => {
    expect(mapHeaders(["something", "else"]).reference).toBeUndefined();
  });
});

describe("parseAmount", () => {
  it.each([
    ["100", 10_000],
    ["$1,234.56", 123_456],
    ["1234.5", 123_450],
    ["", 0],
    ["-", 0],
    ["(50)", -5_000],
    ["-50", -5_000],
    ["£99", 9_900],
  ])("reads %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("returns null for something that is not a number", () => {
    expect(parseAmount("n/a")).toBeNull();
    expect(parseAmount("pending")).toBeNull();
  });

  it("distinguishes an absent column from a blank cell", () => {
    // Absent: derive it from the other figures.
    expect(parseAmount(undefined)).toBeNull();
    // Present and blank: nothing was deducted.
    expect(parseAmount("")).toBe(0);
  });
});

describe("parseStatement", () => {
  it("derives net from gross and deductions", () => {
    const parsed = parseStatement("Reference,Gross,Commission\nBG-1,1000,400");
    expect(parsed.lines[0].gross.minor).toBe(100_000);
    expect(parsed.lines[0].deductions.minor).toBe(40_000);
    expect(parsed.lines[0].net.minor).toBe(60_000);
    expect(parsed.lines[0].problems).toHaveLength(0);
  });

  it("derives deductions from gross and net", () => {
    const parsed = parseStatement("Reference,Gross,Net\nBG-1,1000,600");
    expect(parsed.lines[0].deductions.minor).toBe(40_000);
  });

  it("derives gross from net and deductions", () => {
    const parsed = parseStatement("Reference,Net,Commission\nBG-1,600,400");
    expect(parsed.lines[0].gross.minor).toBe(100_000);
  });

  it("says so rather than inventing a commission when only one figure exists", () => {
    const parsed = parseStatement("Reference,Amount\nBG-1,840");
    expect(parsed.lines[0].gross.minor).toBe(84_000);
    expect(parsed.lines[0].net.minor).toBe(84_000);
    expect(parsed.lines[0].deductions.minor).toBe(0);
    expect(parsed.lines[0].problems.join(" ")).toMatch(/net assumed equal/i);
  });

  it("keeps an unreadable line and flags it rather than dropping it", () => {
    const parsed = parseStatement("Reference,Gross\nBG-1,pending");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.unreadableCount).toBe(1);
    expect(parsed.lines[0].problems.join(" ")).toMatch(/no readable amount/i);
  });

  it("flags a line with no reference", () => {
    const parsed = parseStatement("Reference,Gross\n,500");
    expect(parsed.lines[0].problems.join(" ")).toMatch(/no reference/i);
  });

  it("preserves the original row exactly", () => {
    const parsed = parseStatement('Reference,Caption,Gross\nBG-1,"Hart, Avery",1000');
    expect(parsed.lines[0].raw).toEqual({
      Reference: "BG-1",
      Caption: "Hart, Avery",
      Gross: "1000",
    });
  });

  it("totals gross and net across the file", () => {
    const parsed = parseStatement("Reference,Gross,Commission\nBG-1,1000,400\nBG-2,500,200");
    expect(parsed.totalGross.minor).toBe(150_000);
    expect(parsed.totalNet.minor).toBe(90_000);
  });

  it("returns an empty result for an empty file", () => {
    const parsed = parseStatement("");
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.totalGross.minor).toBe(0);
  });
});

const CANDIDATES: MatchCandidate[] = [
  {
    submissionId: "sub_1",
    reference: "BG-0819-441",
    expected: money(84_000),
    label: "BG-0819-441 · Backgrid",
  },
  {
    submissionId: "sub_2",
    reference: "BG-0820-902",
    expected: money(62_000),
    label: "BG-0820-902 · Backgrid",
  },
  {
    licenseId: "lic_1",
    reference: "MS-DIRECT-1042",
    expected: money(64_000),
    label: "The City Paper",
  },
];

describe("matchLines", () => {
  it("matches an exact reference", () => {
    const parsed = parseStatement("Reference,Gross\nBG-0819-441,840");
    const [match] = matchLines(parsed.lines, CANDIDATES);
    expect(match.status).toBe("matched");
    expect(match.candidate?.submissionId).toBe("sub_1");
    expect(match.discrepancy).toBeUndefined();
  });

  it("matches regardless of punctuation and case", () => {
    const parsed = parseStatement("Reference,Gross\nbg0819441,840");
    expect(matchLines(parsed.lines, CANDIDATES)[0].status).toBe("matched");
  });

  it("reports a discrepancy when the amount differs from the expectation", () => {
    const parsed = parseStatement("Reference,Gross\nBG-0819-441,900");
    const [match] = matchLines(parsed.lines, CANDIDATES);
    expect(match.status).toBe("matched");
    expect(match.discrepancy?.minor).toBe(6_000);
  });

  it("reports a shortfall as a negative discrepancy", () => {
    const parsed = parseStatement("Reference,Gross\nBG-0819-441,800");
    expect(matchLines(parsed.lines, CANDIDATES)[0].discrepancy?.minor).toBe(-4_000);
  });

  it("suggests rather than matches when the reference is embedded", () => {
    const parsed = parseStatement("Reference,Gross\nINV BG-0819-441 AUG,840");
    const [match] = matchLines(parsed.lines, CANDIDATES);
    expect(match.status).toBe("suggested");
    expect(match.basis).toMatch(/contains/i);
  });

  it("suggests on a uniquely matching amount", () => {
    const parsed = parseStatement("Reference,Gross\nUNKNOWN-REF,620");
    const [match] = matchLines(parsed.lines, CANDIDATES);
    expect(match.status).toBe("suggested");
    expect(match.candidate?.submissionId).toBe("sub_2");
    expect(match.basis).toMatch(/nothing else/i);
  });

  it("refuses to choose when a reference is ambiguous", () => {
    const duplicated: MatchCandidate[] = [
      { submissionId: "a", reference: "SAME-1", label: "A" },
      { submissionId: "b", reference: "SAME-1", label: "B" },
    ];
    const parsed = parseStatement("Reference,Gross\nSAME-1,100");
    const [match] = matchLines(parsed.lines, duplicated);
    expect(match.status).toBe("unmatched");
    expect(match.basis).toMatch(/matches 2 records/i);
  });

  it("refuses to guess when two records share an amount", () => {
    const sameAmount: MatchCandidate[] = [
      { submissionId: "a", reference: "A-1", expected: money(50_000), label: "A" },
      { submissionId: "b", reference: "B-1", expected: money(50_000), label: "B" },
    ];
    const parsed = parseStatement("Reference,Gross\nNOPE,500");
    expect(matchLines(parsed.lines, sameAmount)[0].status).toBe("unmatched");
  });

  it("leaves a line with no reference and no amount match unmatched", () => {
    const parsed = parseStatement("Reference,Gross\n,999");
    const [match] = matchLines(parsed.lines, CANDIDATES);
    expect(match.status).toBe("unmatched");
    expect(match.basis).toMatch(/no reference/i);
  });

  it("always states a basis, whatever the outcome", () => {
    const parsed = parseStatement(
      "Reference,Gross\nBG-0819-441,840\nUNKNOWN,999\nINV BG-0820-902 X,620",
    );
    for (const match of matchLines(parsed.lines, CANDIDATES)) {
      expect(match.basis.length).toBeGreaterThan(10);
    }
  });
});
