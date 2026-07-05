import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Card, Label, Pill, ProgressBar, Row, SectionHeader, useTheme } from '../components/ui';
import {
  budgetCash, inMyPocket, incomeForMonth, netWorth, readyToAssign,
  spendingForMonth, totalAssigned, upcomingBills,
} from '../logic/budget';
import { fmt, fmtShort } from '../utils/money';
import { dateLabel, daysInMonth, monthKey, monthLabel, todayIso } from '../utils/dates';
import { sortTransactions } from '../logic/budget';
import { INCOME_CATEGORY_ID } from '../types';

export function HomeScreen({ onGoToTab }: { onGoToTab: (tab: string) => void }) {
  const t = useTheme();
  const store = useStore();
  const month = monthKey();

  const pocket = inMyPocket(store, month);
  const rta = readyToAssign(store, month);
  const nw = netWorth(store);
  const income = incomeForMonth(store, month);
  const spent = spendingForMonth(store, month);
  const budgeted = totalAssigned(store, month);
  const bills = upcomingBills(store).slice(0, 4);
  const recent = sortTransactions(store.transactions).slice(0, 5);

  // PocketGuard-style "Pace": are you spending faster than the month is passing?
  const dayNum = Number(todayIso().slice(8, 10));
  const monthFrac = dayNum / daysInMonth(month);
  const spendFrac = budgeted > 0 ? spent / budgeted : 0;
  const paceOk = spendFrac <= monthFrac + 0.02;

  const catName = (id: string | null) => {
    const c = store.categories.find((x) => x.id === id);
    return c ? `${c.emoji} ${c.name}` : 'Uncategorized';
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      <Text style={[type.caption, { color: t.inkMuted, marginBottom: 2 }]}>{monthLabel(month)}</Text>
      <Text style={[type.title, { color: t.inkPrimary, marginBottom: spacing.lg }]}>Survive Budget</Text>

      {store.settings.showSafeToSpend && (
        <Card>
          <Label>In My Pocket · safe to spend</Label>
          <Amount cents={pocket} size="hero" colorize style={{ marginVertical: 4 }} />
          <Label>
            {fmt(budgetCash(store))} cash − envelopes, goals & bills still due this month
          </Label>
          <View style={{ marginTop: spacing.md }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <Label>Spending pace</Label>
              <Text style={[type.tiny, { color: paceOk ? t.goodText : t.critical }]}>
                {paceOk ? '✓ on pace' : '⚠ ahead of pace'} · {Math.round(spendFrac * 100)}% spent, {Math.round(monthFrac * 100)}% of month gone
              </Text>
            </Row>
            <ProgressBar fraction={spendFrac} color={paceOk ? t.good : t.serious} />
          </View>
        </Card>
      )}

      <Row style={{ gap: spacing.md, marginTop: spacing.md }}>
        <Card style={{ flex: 1 }}>
          <Label>Income</Label>
          <Text style={[type.heading, { color: t.goodText, fontVariant: ['tabular-nums'] }]}>
            {fmtShort(Math.round(income / 100) * 100)}
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Label>Spent</Label>
          <Text style={[type.heading, { color: t.critical, fontVariant: ['tabular-nums'] }]}>
            {fmtShort(-Math.round(spent / 100) * 100)}
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Label>Net worth</Label>
          <Text style={[type.heading, { color: t.inkPrimary, fontVariant: ['tabular-nums'] }]}>
            {fmtShort(Math.round(nw.total / 100) * 100)}
          </Text>
        </Card>
      </Row>

      {rta !== 0 && (
        <Pressable onPress={() => onGoToTab('budget')}>
          <Card style={{ marginTop: spacing.md, backgroundColor: rta > 0 ? t.accentSoft : undefined }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Text style={[type.heading, { color: t.inkPrimary }]}>
                  {rta > 0 ? 'Ready to assign' : 'Over-assigned'}
                </Text>
                <Label>{rta > 0 ? 'Give every dollar a job →' : 'You assigned more than you have →'}</Label>
              </View>
              <Amount cents={rta} size="title" colorize={rta < 0} />
            </Row>
          </Card>
        </Pressable>
      )}

      <SectionHeader
        title="Upcoming bills"
        right={<Pill label="See all" onPress={() => onGoToTab('more')} />}
      />
      <Card>
        {bills.length === 0 ? (
          <Label>No bills due in the next 45 days 🎉</Label>
        ) : (
          bills.map((b, i) => (
            <Row
              key={b.id}
              style={{
                justifyContent: 'space-between',
                paddingVertical: 10,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: t.gridline,
              }}
            >
              <View>
                <Text style={[type.body, { color: t.inkPrimary }]}>{b.name}</Text>
                <Label style={{ color: b.overdue ? t.critical : t.inkMuted }}>
                  {b.overdue
                    ? `Overdue · was due ${dateLabel(b.dueIso)}`
                    : b.daysUntil === 0
                      ? 'Due today'
                      : `Due in ${b.daysUntil} day${b.daysUntil === 1 ? '' : 's'}`}
                  {b.autopay ? ' · autopay' : ''}
                </Label>
              </View>
              <Amount cents={-b.amount} />
            </Row>
          ))
        )}
      </Card>

      <SectionHeader
        title="Recent transactions"
        right={<Pill label="See all" onPress={() => onGoToTab('transactions')} />}
      />
      <Card>
        {recent.map((tx, i) => (
          <Row
            key={tx.id}
            style={{
              justifyContent: 'space-between', paddingVertical: 10,
              borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.gridline,
            }}
          >
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={[type.body, { color: t.inkPrimary }]} numberOfLines={1}>{tx.payee}</Text>
              <Label>
                {dateLabel(tx.date)} · {tx.categoryId === INCOME_CATEGORY_ID ? '💰 Income' : catName(tx.categoryId)}
              </Label>
            </View>
            <Amount cents={tx.amount} colorize={tx.amount > 0} sign={tx.amount > 0} />
          </Row>
        ))}
      </Card>
    </ScrollView>
  );
}
