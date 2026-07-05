import React, { useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Card, Label, Pill, Row, SectionHeader, useTheme } from '../components/ui';
import { CashFlowBars, Donut, Legend, TrendLine } from '../components/charts';
import {
  cashFlowSeries, detectRecurringPayees, netWorth, netWorthSeries, spendingByCategory,
} from '../logic/budget';
import { addMonths, monthKey, monthLabel, monthLabelShort } from '../utils/dates';
import { fmt, fmtShort } from '../utils/money';

export function ReportsScreen() {
  const t = useTheme();
  const store = useStore();
  const { width } = useWindowDimensions();
  const chartW = Math.min(width, 520) - spacing.lg * 4;
  const [month, setMonth] = useState(monthKey());

  const byCat = spendingByCategory(store, month);
  const flow = cashFlowSeries(store, 6);
  const nwSeries = netWorthSeries(store, 6);
  const nw = netWorth(store);
  const recurring = detectRecurringPayees(store).slice(0, 5);

  const monthIncome = flow.find((f) => f.month === month)?.income ?? 0;
  const monthExpense = flow.find((f) => f.month === month)?.expense ?? 0;

  // Donut folds categories beyond the 8 palette slots into "Other".
  const top = byCat.slice(0, 7);
  const otherTotal = byCat.slice(7).reduce((a, s) => a + s.spent, 0);
  const slices = top.map((s) => ({
    key: s.category.id,
    label: `${s.category.emoji} ${s.category.name}`,
    value: s.spent,
    color: t.series[s.category.colorSlot % t.series.length],
  }));
  if (otherTotal > 0) slices.push({ key: 'other', label: 'Other', value: otherTotal, color: t.inkMuted });

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      <Text style={[type.title, { color: t.inkPrimary, marginBottom: spacing.md }]}>Reports</Text>

      <Row style={{ gap: spacing.sm, marginBottom: spacing.md }}>
        <Pill label={`‹ ${monthLabelShort(addMonths(month, -1))}`} onPress={() => setMonth(addMonths(month, -1))} />
        <Pill label={monthLabel(month)} active />
        <Pill label={`${monthLabelShort(addMonths(month, 1))} ›`} onPress={() => setMonth(addMonths(month, 1))} />
      </Row>

      <Card>
        <SectionHeader title="Spending by category" right={null} />
        <Donut slices={slices} centerLabel="Total spent" />
        <Legend items={slices.map((s) => ({ label: s.label, color: s.color, value: fmtShort(s.value) }))} />
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Income vs spending · 6 months" right={null} />
        <CashFlowBars
          data={flow.map((f) => ({ label: monthLabelShort(f.month), income: f.income, expense: f.expense }))}
          width={chartW}
          height={170}
          incomeColor={t.series[1]}
          expenseColor={t.series[0]}
        />
        <Legend
          items={[
            { label: 'Income', color: t.series[1] },
            { label: 'Spending', color: t.series[0] },
          ]}
        />
        <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
          <View>
            <Label>{monthLabel(month)} net</Label>
            <Amount cents={monthIncome - monthExpense} size="heading" colorize sign />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Label>Savings rate</Label>
            <Text style={[type.heading, { color: t.inkPrimary }]}>
              {monthIncome > 0 ? `${Math.max(0, Math.round(((monthIncome - monthExpense) / monthIncome) * 100))}%` : '—'}
            </Text>
          </View>
        </Row>
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Net worth trend" right={null} />
        <TrendLine
          points={nwSeries.map((p) => p.value)}
          labels={nwSeries.map((p) => monthLabelShort(p.month))}
          width={chartW}
          color={t.series[0]}
        />
        <Row style={{ justifyContent: 'space-between', marginTop: spacing.md }}>
          <View>
            <Label>Assets</Label>
            <Text style={[type.body, { color: t.goodText, fontVariant: ['tabular-nums'] }]}>{fmt(nw.assets)}</Text>
          </View>
          <View>
            <Label>Liabilities</Label>
            <Text style={[type.body, { color: t.critical, fontVariant: ['tabular-nums'] }]}>-{fmt(nw.liabilities).slice(1)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Label>Net worth</Label>
            <Amount cents={nw.total} size="body" />
          </View>
        </Row>
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Recurring & subscriptions" right={null} />
        <Label style={{ marginBottom: spacing.sm }}>
          Payees detected 3+ times — review for subscriptions you forgot about.
        </Label>
        {recurring.length === 0 ? (
          <Label>Not enough history yet.</Label>
        ) : (
          recurring.map((r, i) => (
            <Row
              key={r.payee}
              style={{
                justifyContent: 'space-between', paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.gridline,
              }}
            >
              <View>
                <Text style={[type.body, { color: t.inkPrimary }]}>{r.payee}</Text>
                <Label>{r.count} charges</Label>
              </View>
              <Amount cents={-r.avg} />
            </Row>
          ))
        )}
      </Card>
    </ScrollView>
  );
}
