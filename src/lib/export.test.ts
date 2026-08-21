import { describe, expect, it } from "vitest";
import { buildExport, csvCell, decimalString, toCsv, type ExportInput } from "./export";
import { money } from "./money";
import { parseCsv } from "./statement-import";

describe("csvCell", () => {
  it.each([
    ["plain", "plain"],
    ["with, comma", '"with, comma"'],
    ['with "quotes"', '"with ""quotes"""'],
    ["with\nnewline", '"with\nnewline"'],
    ["", ""],
  ])("escapes %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("renders zero as 0, not empty", () => {
    expect(csvCell(0)).toBe("0");
  });
});

describe("decimalString", () => {
  it.each([
    [44_800, "448.00"],
    [5, "0.05"],
    [100, "1.00"],
    [0, "0.00"],
    [-19_200, "-192.00"],
    [123_456, "1234.56"],
  ])("renders %i as %s", (minor, expected) => {
    expect(decimalString(money(minor))).toBe(expected);
  });
});

describe("toCsv", () => {
  it("round-trips through the CSV reader", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ["one", 'has "quotes", and a comma'],
        ["two", "line\nbreak"],
      ],
    );
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1][1]).toBe('has "quotes", and a comma');
    expect(rows[2][1]).toBe("line\nbreak");
  });

  it("ends with a newline", () => {
    expect(toCsv(["a"], [["1"]]).endsWith("\n")).toBe(true);
  });
});

const INPUT: ExportInput = {
  organizationName: "Marcus Hale Studio",
  generatedAt: "2026-08-21T12:00:00.000Z",
  assets: [
    {
      id: "ast_1",
      shootId: "sht_1",
      canonicalFilename: "MH_0819_0472",
      status: "active",
      capturedAt: "2026-08-19T18:47:18.000Z",
      headline: "Avery Hart departs Hotel Chelsea",
      caption: "A caption, with a comma.",
      subjects: ["Avery Hart"],
      keywords: ["Hotel Chelsea", "departure"],
      locationName: "New York, NY",
      creatorName: "Marcus Hale",
      creditLine: "Marcus Hale / Mastline",
      copyrightNotice: "© 2026 Marcus Hale",
      usageRestrictions: "Editorial use only.",
      selected: true,
      rating: 5,
      lifetimeEarnings: money(44_800),
      versions: [
        {
          id: "ver_1",
          versionKind: "original",
          storageBucket: "originals",
          objectKey: "org/shoot/file.arw",
          sha256: "a".repeat(64),
          bytes: 52_428_800,
          mimeType: "image/x-sony-arw",
          width: 8640,
          height: 5760,
          createdAt: "2026-08-19T19:26:00.000Z",
        },
      ],
      captionHistory: [
        { id: "rev_2", caption: "Second wording", editedAt: "2026-08-20T14:22:00.000Z" },
        { id: "rev_1", caption: "First wording", editedAt: "2026-08-20T11:05:00.000Z" },
      ],
    },
  ],
  shoots: [
    {
      id: "sht_1",
      title: "Hotel Chelsea departure",
      status: "dispatched",
      priority: "high",
      startsAt: "2026-08-19T18:30:00.000Z",
      locationName: "New York, NY",
      createdAt: "2026-08-19T19:20:00.000Z",
    },
  ],
  submissions: [
    {
      id: "sub_1",
      reference: "BG-0819-441",
      packageId: "pkg_1",
      buyerName: "Backgrid",
      status: "sold",
      deliveryMethod: "SFTP",
      termsSnapshot: "Non-exclusive.",
      sentAt: "2026-08-19T18:52:00.000Z",
      assetCount: 1,
    },
  ],
  licenses: [
    {
      id: "lic_1",
      submissionId: "sub_1",
      licenseeName: "The City Paper",
      origin: "mastline_sales_engine",
      status: "active",
      saleBase: money(64_000),
      salesEngineShare: money(19_200),
      photographerShare: money(44_800),
    },
  ],
  payments: [
    {
      id: "pay_1",
      reference: "MS-DIRECT-1042",
      buyerName: "The City Paper",
      status: "received",
      source: "checkout",
      gross: money(64_000),
      deductions: money(0),
      platformFee: money(19_200),
      tax: money(0),
      net: money(44_800),
      receivedAt: "2026-08-20T00:00:00.000Z",
      allocations: [
        { id: "alc_1", licenseId: "lic_1", assetId: "ast_1", allocated: money(44_800) },
      ],
    },
  ],
  activity: [
    {
      id: "evt_1",
      entityType: "submission",
      entityId: "sub_1",
      action: "submission.sent",
      summary: "Sent to Backgrid",
      createdAt: "2026-08-19T18:52:00.000Z",
    },
  ],
};

function fileNamed(name: string) {
  const file = buildExport(INPUT).find((entry) => entry.name === name);
  if (!file) throw new Error(`No export file named ${name}`);
  return file;
}

describe("buildExport", () => {
  it("produces every documented file", () => {
    const names = buildExport(INPUT).map((file) => file.name);
    expect(names).toEqual([
      "README.txt",
      "assets.csv",
      "asset_versions.csv",
      "caption_history.csv",
      "shoots.csv",
      "submissions.csv",
      "licenses.csv",
      "payments.csv",
      "allocations.csv",
      "activity.csv",
    ]);
  });

  it("names every CSV in the README", () => {
    const readme = fileNamed("README.txt").body;
    for (const file of buildExport(INPUT)) {
      if (file.name.endsWith(".csv")) expect(readme).toContain(file.name);
    }
  });

  it("exports money in both minor units and a decimal", () => {
    const rows = parseCsv(fileNamed("licenses.csv").body);
    const headers = rows[0];
    const row = rows[1];
    expect(row[headers.indexOf("sale_base_minor")]).toBe("64000");
    expect(row[headers.indexOf("sale_base_decimal")]).toBe("640.00");
    expect(row[headers.indexOf("sales_engine_share_minor")]).toBe("19200");
    expect(row[headers.indexOf("photographer_share_decimal")]).toBe("448.00");
  });

  it("keeps the payment breakdown separable", () => {
    const rows = parseCsv(fileNamed("payments.csv").body);
    const headers = rows[0];
    const row = rows[1];
    const value = (column: string) => Number(row[headers.indexOf(column)]);
    expect(
      value("deductions_minor") +
        value("sales_engine_fee_minor") +
        value("tax_minor") +
        value("net_minor"),
    ).toBe(value("gross_minor"));
  });

  it("survives a caption containing a comma", () => {
    const rows = parseCsv(fileNamed("assets.csv").body);
    const caption = rows[1][rows[0].indexOf("caption")];
    expect(caption).toBe("A caption, with a comma.");
  });

  it("exports the SHA-256 so a file can be verified outside Mastline", () => {
    const rows = parseCsv(fileNamed("asset_versions.csv").body);
    expect(rows[1][rows[0].indexOf("sha256")]).toBe("a".repeat(64));
  });

  it("orders caption history oldest first so it reads as a story", () => {
    const rows = parseCsv(fileNamed("caption_history.csv").body);
    expect(rows[1][rows[0].indexOf("caption")]).toBe("First wording");
    expect(rows[2][rows[0].indexOf("caption")]).toBe("Second wording");
  });

  it("connects an allocation back to the licence and the asset", () => {
    const rows = parseCsv(fileNamed("allocations.csv").body);
    const headers = rows[0];
    expect(rows[1][headers.indexOf("license_id")]).toBe("lic_1");
    expect(rows[1][headers.indexOf("asset_id")]).toBe("ast_1");
  });

  it("never includes a confidential source note", () => {
    const everything = buildExport(INPUT)
      .map((file) => file.body)
      .join("\n");
    expect(everything).not.toMatch(/source_note|confidential_location|confidential_identity/);
    expect(fileNamed("README.txt").body).toMatch(/Confidential source notes are NOT included/);
  });

  it("produces valid CSV for every file", () => {
    for (const file of buildExport(INPUT)) {
      if (!file.name.endsWith(".csv")) continue;
      const rows = parseCsv(file.body);
      const width = rows[0].length;
      for (const row of rows) {
        expect(row.length, `${file.name} has a ragged row`).toBe(width);
      }
    }
  });

  it("handles an empty workspace without producing broken files", () => {
    const empty = buildExport({
      ...INPUT,
      assets: [],
      shoots: [],
      submissions: [],
      licenses: [],
      payments: [],
      activity: [],
    });
    for (const file of empty) {
      if (!file.name.endsWith(".csv")) continue;
      // Headers only, and still parseable.
      expect(parseCsv(file.body)).toHaveLength(1);
    }
  });
});
