// Pure helpers turning a set of bills + detected anomalies into the shapes the
// UI renders: a chronological, per-meter timeline for the Recharts TOU chart,
// with each period carrying the anomaly types flagged against it (for badges).

import type { Bill, Anomaly, AnomalyType } from './types.ts'
import { normalizeBill } from './analyzeAnomalies.ts'

export interface TimelineRow {
  billId: string
  meterId: string
  label: string
  startDate: string
  endDate: string
  billingDays: number
  offPeakKwh: number
  midPeakKwh: number
  onPeakKwh: number
  totalKwh: number
  dailyTotalKwh: number
  dailyOffPeakKwh: number
  dailyMidPeakKwh: number
  dailyOnPeakKwh: number
  totalBilledAmount: number
  anomalies: AnomalyType[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jun 2026" from an ISO date — bills are labelled by the month usage started in. */
function monthLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Ascending by start date. Stable for equal dates. */
export function sortChrono(bills: readonly Bill[]): Bill[] {
  return [...bills].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))
}

/** Group bills by meter id, each group chronologically sorted. */
export function groupByMeter(bills: readonly Bill[]): Map<string, Bill[]> {
  const m = new Map<string, Bill[]>()
  for (const b of sortChrono(bills)) {
    const g = m.get(b.meterId)
    if (g) g.push(b)
    else m.set(b.meterId, [b])
  }
  return m
}

/**
 * Build the timeline rows for one already-chronological set of bills, attaching
 * the anomaly types flagged per bill. `daily*` values (not raw totals) are what
 * the chart plots, since 27–33-day periods aren't directly comparable.
 */
export function buildTimeline(bills: readonly Bill[], anomalies: readonly Anomaly[]): TimelineRow[] {
  const byBill = new Map<string, AnomalyType[]>()
  for (const a of anomalies) {
    const g = byBill.get(a.billId)
    if (g) g.push(a.type)
    else byBill.set(a.billId, [a.type])
  }
  return sortChrono(bills).map((bill) => {
    const n = normalizeBill(bill)
    return {
      billId: bill.id,
      meterId: bill.meterId,
      label: monthLabel(bill.startDate),
      startDate: bill.startDate,
      endDate: bill.endDate,
      billingDays: n.billingDays,
      offPeakKwh: bill.offPeakKwh,
      midPeakKwh: bill.midPeakKwh,
      onPeakKwh: bill.onPeakKwh,
      totalKwh: n.totalKwh,
      dailyTotalKwh: Math.round(n.dailyTotalKwh * 100) / 100,
      dailyOffPeakKwh: Math.round(n.dailyOffPeakKwh * 100) / 100,
      dailyMidPeakKwh: Math.round(n.dailyMidPeakKwh * 100) / 100,
      dailyOnPeakKwh: Math.round(n.dailyOnPeakKwh * 100) / 100,
      totalBilledAmount: bill.totalBilledAmount,
      anomalies: byBill.get(bill.id) ?? [],
    }
  })
}
