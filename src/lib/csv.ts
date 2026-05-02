import type { WalletTransaction } from "./types";

export function parseWalletTransactionCsv(raw: string): WalletTransaction[] {
  const rows = parseCsvRows(raw);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const hashIndex = findHeader(headers, ["txhash", "transactionhash", "hash"]);
  if (hashIndex === -1) throw new Error("CSV 中没有找到交易 hash 列。");

  const fromIndex = findHeader(headers, ["from", "fromaddress"]);
  const toIndex = findHeader(headers, ["to", "toaddress"]);
  const blockIndex = findHeader(headers, ["blockno", "blocknumber", "block"]);
  const timestampIndex = findHeader(headers, ["unixtimestamp", "timestamp"]);

  return rows
    .slice(1)
    .map((row) => ({
      hash: row[hashIndex]?.trim() || "",
      from: valueAt(row, fromIndex),
      to: valueAt(row, toIndex),
      blockNumber: numberAt(row, blockIndex),
      timestamp: numberAt(row, timestampIndex),
    }))
    .filter((tx) => /^0x[a-fA-F0-9]{64}$/.test(tx.hash));
}

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.includes(header));
}

function valueAt(row: string[], index: number): string | undefined {
  if (index < 0) return undefined;
  const value = row[index]?.trim();
  return value || undefined;
}

function numberAt(row: string[], index: number): number | undefined {
  const value = valueAt(row, index);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
