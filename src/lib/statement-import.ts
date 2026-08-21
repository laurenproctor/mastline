/**
 * Agency statement parsing and matching.
 *
 * Statements arrive as CSV with no agreed schema: every agency names its
 * columns differently and some report gross while others report net. Rather
 * than demand one format, this recognises the common shapes and reports what it
 * could not read instead of guessing.
 *
 * Nothing here writes anything. Matching produces suggestions with a stated
 * basis; a person decides. That is the same discipline the rights and archive
 * suggestions follow.
 */

import { type Money, fromMajor, money, subtract } from "./money";

export interface ParsedLine {
  readonly lineNumber: number;
  readonly raw: Record<string, string>;
  readonly externalReference?: string;
  readonly description?: string;
  readonly gross: Money;
  readonly deductions: Money;
  readonly net: Money;
  readonly paidAt?: string;
  /** Anything that could not be read. The line is still kept. */
  readonly problems: readonly string[];
}

export interface ParsedStatement {
  readonly lines: readonly ParsedLine[];
  readonly headers: readonly string[];
  readonly totalGross: Money;
  readonly totalNet: Money;
  readonly unreadableCount: number;
}

/**
 * A small RFC 4180 reader: quoted fields, escaped quotes, embedded newlines.
 *
 * A hand-rolled split on commas mangles any caption containing one, and
 * captions are exactly what appears in these files.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  const source = text.replace(/^﻿/, "");

  while (index < source.length) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

const HEADER_ALIASES: Record<string, readonly string[]> = {
  reference: ["reference", "ref", "image id", "imageid", "image_id", "id", "invoice", "submission"],
  description: ["description", "caption", "detail", "title", "usage", "item"],
  gross: ["gross", "gross amount", "sale", "sale amount", "amount", "fee", "total"],
  deductions: ["deductions", "commission", "agency fee", "fee deducted", "withheld"],
  net: ["net", "net amount", "payable", "your share", "photographer"],
  paidAt: ["date", "paid", "paid date", "payment date", "settled"],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/** Map a file's headers onto the fields we understand. */
export function mapHeaders(headers: readonly string[]): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const mapping: Record<string, number> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index !== -1) mapping[field] = index;
  }
  return mapping;
}

/**
 * Read a money cell. Handles $, thousands separators, and parenthesised
 * negatives.
 *
 * `undefined` means the column is absent, so the value has to be derived from
 * the others. An empty or dashed cell means the column is present and the
 * figure is zero. Collapsing those two would turn "nothing was deducted" into
 * "we do not know", which changes what gets derived.
 */
export function parseAmount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (text === "" || text === "-" || text === "—") return 0;

  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  const digits = text.replace(/[()$£€,\s-]/g, "");
  if (digits === "" || !/^\d*\.?\d*$/.test(digits)) return null;

  const amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  return fromMajor(negative ? -amount : amount).minor;
}

/**
 * Parse a statement.
 *
 * Where only two of gross, deductions, and net are present the third is
 * derived. Where only one is present it is treated as both gross and net, and
 * the line says so, because assuming a hidden commission would invent money.
 */
export function parseStatement(text: string, currency: Money["currency"] = "USD"): ParsedStatement {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      lines: [],
      headers: [],
      totalGross: money(0, currency),
      totalNet: money(0, currency),
      unreadableCount: 0,
    };
  }

  const headers = rows[0].map((header) => header.trim());
  const mapping = mapHeaders(headers);
  const lines: ParsedLine[] = [];

  let totalGross = 0;
  let totalNet = 0;
  let unreadable = 0;

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const problems: string[] = [];

    const raw: Record<string, string> = {};
    headers.forEach((header, position) => {
      raw[header || `column_${position + 1}`] = cells[position] ?? "";
    });

    const cell = (field: string): string | undefined =>
      mapping[field] === undefined ? undefined : cells[mapping[field]];

    const grossRaw = parseAmount(cell("gross"));
    const deductionsRaw = parseAmount(cell("deductions"));
    const netRaw = parseAmount(cell("net"));

    let gross = grossRaw;
    let deductions = deductionsRaw;
    let net = netRaw;

    if (gross === null && net !== null && deductions !== null) gross = net + deductions;
    if (net === null && gross !== null && deductions !== null) net = gross - deductions;
    if (deductions === null && gross !== null && net !== null) deductions = gross - net;

    if (gross === null && net !== null) {
      gross = net;
      deductions = 0;
      problems.push("Only a net amount was present; gross assumed equal.");
    }
    if (net === null && gross !== null) {
      net = gross;
      deductions = deductions ?? 0;
      problems.push("Only a gross amount was present; net assumed equal.");
    }

    if (gross === null || net === null) {
      gross = 0;
      deductions = 0;
      net = 0;
      problems.push("No readable amount on this line.");
      unreadable += 1;
    }

    if (deductions === null) deductions = 0;

    const reference = cell("reference")?.trim();
    if (!reference) problems.push("No reference to match against.");

    totalGross += gross;
    totalNet += net;

    lines.push({
      lineNumber: index,
      raw,
      externalReference: reference || undefined,
      description: cell("description")?.trim() || undefined,
      gross: money(gross, currency),
      deductions: money(deductions, currency),
      net: money(net, currency),
      paidAt: cell("paidAt")?.trim() || undefined,
      problems,
    });
  }

  return {
    lines,
    headers,
    totalGross: money(totalGross, currency),
    totalNet: money(totalNet, currency),
    unreadableCount: unreadable,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  readonly submissionId?: string;
  readonly licenseId?: string;
  readonly reference: string;
  readonly expected?: Money;
  readonly label: string;
}

export type MatchStatus = "matched" | "suggested" | "unmatched";

export interface LineMatch {
  readonly lineNumber: number;
  readonly status: MatchStatus;
  readonly candidate?: MatchCandidate;
  /** Why this match was proposed. Always rendered next to the suggestion. */
  readonly basis: string;
  /** Set when the amount differs from what was expected. */
  readonly discrepancy?: Money;
}

function normalizeReference(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Match statement lines to submissions and licences.
 *
 * An exact reference match is treated as matched. A reference that appears
 * inside the line's text, or an amount that uniquely equals one expected
 * figure, is a suggestion for a person to confirm. Everything else is
 * unmatched, which is a perfectly good answer.
 */
export function matchLines(
  lines: readonly ParsedLine[],
  candidates: readonly MatchCandidate[],
): readonly LineMatch[] {
  const byReference = new Map<string, MatchCandidate[]>();
  for (const candidate of candidates) {
    const key = normalizeReference(candidate.reference);
    if (!key) continue;
    byReference.set(key, [...(byReference.get(key) ?? []), candidate]);
  }

  const amountIndex = new Map<number, MatchCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.expected) continue;
    const key = candidate.expected.minor;
    amountIndex.set(key, [...(amountIndex.get(key) ?? []), candidate]);
  }

  return lines.map((line) => {
    const reference = line.externalReference ? normalizeReference(line.externalReference) : "";

    if (reference) {
      const exact = byReference.get(reference);
      if (exact && exact.length === 1) {
        const candidate = exact[0];
        const discrepancy =
          candidate.expected && candidate.expected.minor !== line.gross.minor
            ? subtract(line.gross, candidate.expected)
            : undefined;
        return {
          lineNumber: line.lineNumber,
          status: "matched",
          candidate,
          basis: `Reference ${line.externalReference} matches ${candidate.label} exactly.`,
          discrepancy,
        };
      }
      if (exact && exact.length > 1) {
        return {
          lineNumber: line.lineNumber,
          status: "unmatched",
          basis: `Reference ${line.externalReference} matches ${exact.length} records. Choose one.`,
        };
      }

      // The reference may be embedded in a longer string.
      const partial = candidates.filter((candidate) => {
        const key = normalizeReference(candidate.reference);
        return key.length >= 6 && (reference.includes(key) || key.includes(reference));
      });
      if (partial.length === 1) {
        return {
          lineNumber: line.lineNumber,
          status: "suggested",
          candidate: partial[0],
          basis: `Reference ${line.externalReference} contains ${partial[0].reference}.`,
        };
      }
    }

    const sameAmount = amountIndex.get(line.gross.minor);
    if (sameAmount && sameAmount.length === 1) {
      return {
        lineNumber: line.lineNumber,
        status: "suggested",
        candidate: sameAmount[0],
        basis: `Amount matches the expected figure for ${sameAmount[0].label}, and nothing else.`,
      };
    }

    return {
      lineNumber: line.lineNumber,
      status: "unmatched",
      basis: line.externalReference
        ? `No record matches reference ${line.externalReference}.`
        : "No reference on this line.",
    };
  });
}
