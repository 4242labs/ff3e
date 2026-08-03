// Report aggregation — booked transactions in, one ranked bar list per currency out.
//
// A report answers "how much, on what, over this window". Whichever View is
// selected, the shape is the same: collapse the window's transactions onto a
// subject, rank the subjects by total, page through them. Only the definition of
// "subject" changes — the transaction itself, or its category.

import { UNCATEGORISED, type FilterOptions } from './filters'
import type { BookedTransaction, ItemType, ReportView } from './types'

/** Direction of money, as the ledger records it. */
export type Flow = 'out' | 'in' | 'xfer'

const DIRECTION: Record<ItemType, Flow> = {
  withdrawal: 'out',
  deposit: 'in',
  transfer: 'xfer',
}

export const FLOW_LABEL: Record<Flow, string> = {
  out: 'Expense',
  in: 'Income',
  xfer: 'Transfer',
}

/** Bucket label for a transaction Firefly left uncategorised. */
const UNCATEGORISED_LABEL = 'Uncategorised'

/** Rows per page. A month can hold hundreds of transactions; the card shows a
 * page at a time rather than a scroll with no end in sight. */
export const PAGE_SIZE = 25

export interface ReportRow {
  /** Unique within its currency's list. */
  key: string
  label: string
  /** Secondary line: the date for a transaction, the count for a category. */
  detail: string
  total: number
  /** Transactions rolled into this row (1 for the Transactions view). */
  count: number
  flow: Flow
}

export interface ReportCard {
  /** Unique across the page — currency, plus the month when grouping is on. */
  key: string
  /** Card heading: the currency, or "May 2026 · BRL" when grouped by month. */
  title: string
  currency: string
  /** Present only when grouping by month; sorts the cards chronologically. */
  monthKey: string | null
  /** Ranked, largest first. Every row, unpaged — the card pages it for display. */
  rows: ReportRow[]
  /** The largest row total, i.e. what a full-width bar represents. */
  max: number
}

const _shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const _monthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return _shortDate.format(new Date(y, m - 1, d))
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  if (!y || !m) return iso
  return _monthLabel.format(new Date(y, m - 1, 1))
}

/**
 * Build one ranked card per currency — and, with `groupByMonth`, per month too.
 *
 * Currency always splits: totals never cross-sum ISO codes, and a bar whose
 * length meant BRL on one row and USD on the next would be a lie. Direction does
 * NOT split — every transaction in the window is listed — so each row carries
 * its own flow and the card colours it accordingly.
 *
 * Grouping by month splits again, one card per calendar month, each ranked and
 * scaled independently. That is the point: a month's biggest line should fill
 * its own card, not sit as a stub next to a bigger month's.
 */
export function buildReport(
  transactions: BookedTransaction[],
  view: ReportView,
  groupByMonth = false,
): ReportCard[] {
  const byCard = new Map<string, ReportCard>()
  const byRow = new Map<string, ReportRow>()

  for (const tx of transactions) {
    const flow = DIRECTION[tx.type]
    const currency = tx.currency
    const monthKey = groupByMonth ? tx.date.slice(0, 7) : null
    const cardKey = monthKey ? `${monthKey}|${currency}` : currency

    let bucket = byCard.get(cardKey)
    if (!bucket) {
      bucket = {
        key: cardKey,
        title: monthKey ? `${monthLabel(tx.date)} · ${currency}` : currency,
        currency,
        monthKey,
        rows: [],
        max: 0,
      }
      byCard.set(cardKey, bucket)
    }

    if (view === 'categories') {
      // One bar per category. An uncategorised transaction is bucketed, never
      // dropped — "no category" is a real answer with a real total. Flow is part
      // of the key: a category that both spends and receives is two honest bars,
      // not one netted-out number.
      const label = tx.category ?? UNCATEGORISED_LABEL
      const rowKey = `${cardKey}|cat|${flow}|${label}`
      let row = byRow.get(rowKey)
      if (!row) {
        row = { key: rowKey, label, detail: '', total: 0, count: 0, flow }
        byRow.set(rowKey, row)
        bucket.rows.push(row)
      }
      row.total += tx.amount
      row.count += 1
    } else {
      // One bar per transaction. Firefly's id is per transaction GROUP, so a
      // split transaction reuses it across its legs — the row counter keeps the
      // key unique without pretending the legs are one row.
      const rowKey = `${cardKey}|tx|${tx.id ?? 'x'}|${byRow.size}`
      const row: ReportRow = {
        key: rowKey,
        label: tx.description,
        detail: shortDate(tx.date),
        total: tx.amount,
        count: 1,
        flow,
      }
      byRow.set(rowKey, row)
      bucket.rows.push(row)
    }
  }

  const result = [...byCard.values()]
  for (const bucket of result) {
    // Largest first — a report is a ranking. Ties fall back to the label, so the
    // order is stable across renders instead of depending on insertion.
    bucket.rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    if (view === 'categories') {
      // A category that both spends and receives is two rows, on purpose — netting
      // them would hide both halves. But two rows reading "Uncategorised" look
      // like a duplicate, so the direction goes into the label whenever a name
      // occurs under more than one flow.
      const flowsPerLabel = new Map<string, Set<Flow>>()
      for (const row of bucket.rows) {
        const seen = flowsPerLabel.get(row.label) ?? new Set<Flow>()
        seen.add(row.flow)
        flowsPerLabel.set(row.label, seen)
      }
      for (const row of bucket.rows) {
        if ((flowsPerLabel.get(row.label)?.size ?? 0) > 1) {
          row.label = `${row.label} · ${FLOW_LABEL[row.flow]}`
        }
        row.detail = `${row.count} ${row.count === 1 ? 'transaction' : 'transactions'}`
      }
    }
    bucket.max = bucket.rows.length ? bucket.rows[0].total : 0
  }
  // Chronological first when grouped, then by currency — so the same currency
  // stays in the same column as you scan across months.
  return result.sort(
    (a, b) =>
      (a.monthKey ?? '').localeCompare(b.monthKey ?? '') ||
      a.currency.localeCompare(b.currency),
  )
}

export function pageCount(rows: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(rows / size))
}

export function pageOf<T>(rows: T[], page: number, size: number = PAGE_SIZE): T[] {
  return rows.slice(page * size, page * size + size)
}

// --- Filtering ---------------------------------------------------------------
// Same faceted semantics as the forecast view, over the transaction shape.

/** The user's own account on a transaction — a withdrawal's source, a deposit's
 * destination, both ends of a transfer. Firefly guarantees the opposite end is a
 * payee/payer, which is why those never pollute the Account facet. */
function ownAccountsOf(tx: BookedTransaction): string[] {
  switch (tx.type) {
    case 'withdrawal':
      return tx.source ? [tx.source] : []
    case 'deposit':
      return tx.destination ? [tx.destination] : []
    case 'transfer':
      return [tx.source, tx.destination].filter((a): a is string => a !== null)
  }
}

/** Facet universe over the UNFILTERED window, so narrowing one facet never
 * shrinks another's options. */
export function getTransactionFilterOptions(
  transactions: BookedTransaction[],
): FilterOptions {
  const types = new Set<ItemType>()
  const categories = new Set<string>()
  let hasUncategorised = false
  const accounts = new Set<string>()
  const currencies = new Set<string>()

  for (const tx of transactions) {
    types.add(tx.type)
    if (tx.category) categories.add(tx.category)
    else hasUncategorised = true
    for (const a of ownAccountsOf(tx)) accounts.add(a)
    if (tx.currency) currencies.add(tx.currency)
  }

  const categoryOptions = [...categories]
    .sort((a, b) => a.localeCompare(b))
    .map((c) => ({ value: c, label: c }))
  if (hasUncategorised) {
    categoryOptions.push({ value: UNCATEGORISED, label: UNCATEGORISED_LABEL })
  }

  return {
    types: [...types].sort(),
    categories: categoryOptions,
    accounts: [...accounts].sort((a, b) => a.localeCompare(b)),
    currencies: [...currencies].sort((a, b) => a.localeCompare(b)),
  }
}

/** An empty facet is unconstrained; a non-empty one is OR within the facet and
 * AND across facets. */
export function filterTransactions(
  transactions: BookedTransaction[],
  filters: { type: ItemType[]; category: string[]; account: string[]; currency: string[] },
): BookedTransaction[] {
  return transactions.filter((tx) => {
    if (filters.type.length && !filters.type.includes(tx.type)) return false
    if (filters.category.length && !filters.category.includes(tx.category ?? UNCATEGORISED)) {
      return false
    }
    if (filters.account.length && !ownAccountsOf(tx).some((a) => filters.account.includes(a))) {
      return false
    }
    if (filters.currency.length && !filters.currency.includes(tx.currency)) return false
    return true
  })
}
