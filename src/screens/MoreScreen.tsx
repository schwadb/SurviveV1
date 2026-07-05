import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Button, Card, Label, Pill, ProgressBar, Row, SectionHeader, useTheme } from '../components/ui';
import { AccountForm, BillForm, ContributeForm, CsvImportForm, GoalForm, RuleForm } from '../components/forms';
import { accountBalance, isCredit, netWorth, upcomingBills } from '../logic/budget';
import { fmt } from '../utils/money';
import { dateLabel, monthKey } from '../utils/dates';
import { transactionsToCsv } from '../utils/csv';

const TYPE_LABEL: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash',
  credit: 'Credit Card', investment: 'Investment', loan: 'Loan',
};

async function exportCsv(csv: string) {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'survive-budget-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ message: csv, title: 'Survive Budget transactions.csv' });
  }
}

export function MoreScreen() {
  const t = useTheme();
  const store = useStore();
  const [accountForm, setAccountForm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [goalForm, setGoalForm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [contributeId, setContributeId] = useState<string | null>(null);
  const [billForm, setBillForm] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmReset, setConfirmReset] = useState<'demo' | 'clear' | null>(null);

  const nw = netWorth(store);
  const bills = upcomingBills(store, 60);
  const month = monthKey();
  const payAccount = store.accounts.find((a) => a.onBudget && !isCredit(a)) ?? store.accounts[0];

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      <Text style={[type.title, { color: t.inkPrimary }]}>More</Text>

      <SectionHeader title="Accounts & net worth" right={<Pill label="+ Add" onPress={() => setAccountForm({ open: true, id: null })} />} />
      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <Label>Net worth</Label>
          <Amount cents={nw.total} size="heading" />
        </Row>
        {store.accounts.filter((a) => !a.archived).map((a, i) => {
          const bal = accountBalance(store, a.id);
          return (
            <Pressable
              key={a.id}
              onPress={() => setAccountForm({ open: true, id: a.id })}
              style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.gridline }}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <View>
                  <Text style={[type.body, { color: t.inkPrimary }]}>{a.name}</Text>
                  <Label>
                    {TYPE_LABEL[a.type]}{a.onBudget ? ' · on budget' : ' · tracking'}
                  </Label>
                </View>
                <Amount cents={bal} colorize={bal < 0} />
              </Row>
            </Pressable>
          );
        })}
      </Card>

      <SectionHeader title="Savings goals" right={<Pill label="+ Add" onPress={() => setGoalForm({ open: true, id: null })} />} />
      <Card>
        {store.goals.length === 0 ? (
          <Label>No goals yet — create one to start saving with purpose.</Label>
        ) : (
          store.goals.map((g, i) => {
            const frac = g.target > 0 ? g.saved / g.target : 0;
            return (
              <Pressable
                key={g.id}
                onPress={() => setContributeId(g.id)}
                onLongPress={() => setGoalForm({ open: true, id: g.id })}
                style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.gridline }}
              >
                <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={[type.body, { color: t.inkPrimary }]}>{g.emoji} {g.name}</Text>
                  <Label>
                    {fmt(g.saved)} / {fmt(g.target)} · {Math.min(100, Math.round(frac * 100))}%
                  </Label>
                </Row>
                <ProgressBar fraction={frac} color={t.series[g.colorSlot % t.series.length]} />
                <Label style={{ fontSize: 11, marginTop: 4 }}>tap to contribute · hold to edit</Label>
              </Pressable>
            );
          })
        )}
      </Card>

      <SectionHeader title="Recurring bills" right={<Pill label="+ Add" onPress={() => setBillForm({ open: true, id: null })} />} />
      <Card>
        {bills.length === 0 && store.bills.length === 0 ? (
          <Label>Track rent, utilities and subscriptions with due-date reminders.</Label>
        ) : (
          store.bills.map((b, i) => {
            const paid = b.paidMonths.includes(month);
            const upcoming = bills.find((u) => u.id === b.id);
            return (
              <Pressable
                key={b.id}
                onPress={() => setBillForm({ open: true, id: b.id })}
                style={{ paddingVertical: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.gridline }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.body, { color: t.inkPrimary }]}>{b.name}</Text>
                    <Label style={{ color: upcoming?.overdue ? t.critical : t.inkMuted }}>
                      {paid
                        ? '✓ paid this month'
                        : upcoming
                          ? upcoming.overdue
                            ? `Overdue · was due ${dateLabel(upcoming.dueIso)}`
                            : `Due ${dateLabel(upcoming.dueIso)}`
                          : `Due day ${b.dueDay}`}
                      {b.autopay ? ' · autopay' : ''}
                    </Label>
                  </View>
                  <Row style={{ gap: spacing.sm }}>
                    <Amount cents={-b.amount} />
                    {!paid && payAccount && (
                      <Pill
                        label="Mark paid"
                        tone="good"
                        active
                        onPress={() => store.payBill(b.id, payAccount.id)}
                      />
                    )}
                  </Row>
                </Row>
              </Pressable>
            );
          })
        )}
      </Card>

      <SectionHeader title="Auto-categorize rules" right={<Pill label="+ Add" onPress={() => setShowRuleForm(true)} />} />
      <Card>
        <Label style={{ marginBottom: spacing.sm }}>
          New transactions matching a rule get categorized automatically.
        </Label>
        {store.rules.map((r, i) => {
          const cat = store.categories.find((c) => c.id === r.categoryId);
          return (
            <Row
              key={r.id}
              style={{
                justifyContent: 'space-between', paddingVertical: 8,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.gridline,
              }}
            >
              <Text style={[type.body, { color: t.inkPrimary, flex: 1 }]} numberOfLines={1}>
                “{r.match}” → {cat ? `${cat.emoji} ${cat.name}` : '?'}
              </Text>
              <Pill label="Delete" onPress={() => store.deleteRule(r.id)} />
            </Row>
          );
        })}
        <View style={{ marginTop: spacing.sm }}>
          <Button
            title="Apply rules to uncategorized"
            variant="ghost"
            onPress={() => {
              const n = store.applyRulesToExisting();
              if (Platform.OS === 'web') window.alert(`Categorized ${n} transaction${n === 1 ? '' : 's'}.`);
            }}
          />
        </View>
      </Card>

      <SectionHeader title="Data" right={null} />
      <Card>
        <View style={{ gap: spacing.sm }}>
          <Button title="Export transactions (CSV)" variant="ghost" onPress={() => exportCsv(transactionsToCsv(store))} />
          <Button title="Import transactions (CSV)" variant="ghost" onPress={() => setShowImport(true)} />
        </View>
        <Label style={{ marginTop: spacing.md }}>
          🔒 Privacy-first: all data lives on this device. No bank logins, no cloud, no ads.
        </Label>
      </Card>

      <SectionHeader title="Appearance" right={null} />
      <Card>
        <Row style={{ gap: spacing.sm }}>
          {(['system', 'light', 'dark'] as const).map((m) => (
            <Pill
              key={m}
              label={m[0].toUpperCase() + m.slice(1)}
              active={store.settings.themeMode === m}
              onPress={() => store.updateSettings({ themeMode: m })}
            />
          ))}
        </Row>
      </Card>

      <SectionHeader title="Danger zone" right={null} />
      <Card>
        {confirmReset ? (
          <View style={{ gap: spacing.sm }}>
            <Label>
              {confirmReset === 'demo'
                ? 'Replace everything with fresh demo data?'
                : 'Delete ALL data and start empty? This cannot be undone.'}
            </Label>
            <Button
              title={confirmReset === 'demo' ? 'Yes, load demo data' : 'Yes, delete everything'}
              variant="danger"
              onPress={() => {
                if (confirmReset === 'demo') store.resetToDemo();
                else store.clearAllData();
                setConfirmReset(null);
              }}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setConfirmReset(null)} />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Button title="Reset to demo data" variant="ghost" onPress={() => setConfirmReset('demo')} />
            <Button title="Clear all data" variant="ghost" onPress={() => setConfirmReset('clear')} />
          </View>
        )}
      </Card>

      <AccountForm visible={accountForm.open} onClose={() => setAccountForm({ open: false, id: null })} editingId={accountForm.id} />
      <GoalForm visible={goalForm.open} onClose={() => setGoalForm({ open: false, id: null })} editingId={goalForm.id} />
      <ContributeForm visible={!!contributeId} onClose={() => setContributeId(null)} goalId={contributeId} />
      <BillForm visible={billForm.open} onClose={() => setBillForm({ open: false, id: null })} editingId={billForm.id} />
      <RuleForm visible={showRuleForm} onClose={() => setShowRuleForm(false)} />
      <CsvImportForm visible={showImport} onClose={() => setShowImport(false)} />
    </ScrollView>
  );
}
