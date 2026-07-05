import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Button, Card, Label, Pill, ProgressBar, Row, SectionHeader, useTheme } from '../components/ui';
import { AccountForm, BillForm, ContributeForm, GoalForm, RuleForm, StatementImportForm } from '../components/forms';
import { lockAvailable } from '../components/AppLock';
import { accountBalance, isCredit, netWorth, upcomingBills } from '../logic/budget';
import { fmt } from '../utils/money';
import { dateLabel, monthKey, todayIso } from '../utils/dates';
import { transactionsToCsv } from '../utils/csv';
import { parseBackup, serializeBackup } from '../utils/backup';
import { exportTextFile } from '../utils/share';

const TYPE_LABEL: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash',
  credit: 'Credit Card', investment: 'Investment', loan: 'Loan',
};

function notify(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
  else Alert.alert(title, message);
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
  const [canLock, setCanLock] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; text: string } | null>(null);

  useEffect(() => {
    void lockAvailable().then(setCanLock);
  }, []);

  const pickBackupFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/*', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const text = asset.file ? await asset.file.text() : await new FsFile(asset.uri).text();
      const { error } = parseBackup(text);
      if (error) return notify('Cannot restore', error);
      setPendingRestore({ name: asset.name, text });
    } catch (e) {
      notify('Could not read file', e instanceof Error ? e.message : 'Unknown error.');
    }
  };

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
              notify('Rules applied', `Categorized ${n} transaction${n === 1 ? '' : 's'}.`);
            }}
          />
        </View>
      </Card>

      <SectionHeader title="Data" right={null} />
      <Card>
        <View style={{ gap: spacing.sm }}>
          <Button
            title="Export transactions (CSV)"
            variant="ghost"
            onPress={() => exportTextFile('survive-budget-transactions.csv', 'text/csv', transactionsToCsv(store))}
          />
          <Button title="Import statement (CSV / OFX / QFX)" variant="ghost" onPress={() => setShowImport(true)} />
          <Button
            title="Export full backup (JSON)"
            variant="ghost"
            onPress={() =>
              exportTextFile(
                `survive-budget-backup-${todayIso()}.json`,
                'application/json',
                serializeBackup(store, new Date().toISOString()),
              )
            }
          />
          {pendingRestore ? (
            <View style={{ gap: spacing.sm }}>
              <Label>
                Restore “{pendingRestore.name}”? This replaces ALL current data with the backup.
              </Label>
              <Button
                title="Yes, restore backup"
                variant="danger"
                onPress={() => {
                  const { data } = parseBackup(pendingRestore.text);
                  if (data) {
                    store.restoreBackup(data);
                    notify('Restore complete', 'All data replaced from the backup.');
                  }
                  setPendingRestore(null);
                }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setPendingRestore(null)} />
            </View>
          ) : (
            <Button title="Restore backup (JSON)" variant="ghost" onPress={pickBackupFile} />
          )}
        </View>
        <Label style={{ marginTop: spacing.md }}>
          🔒 Privacy-first: all data lives on this device. No bank logins, no cloud, no ads.
          Backup files are unencrypted — store them somewhere safe.
        </Label>
      </Card>

      <SectionHeader title="Security" right={null} />
      <Card>
        {canLock ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={[type.body, { color: t.inkPrimary }]}>App lock</Text>
              <Label>Require Face ID / fingerprint / passcode on launch and when returning to the app</Label>
            </View>
            <Switch
              value={store.settings.appLock ?? false}
              onValueChange={(v) => store.updateSettings({ appLock: v })}
              trackColor={{ true: t.good }}
            />
          </Row>
        ) : (
          <Label>
            {Platform.OS === 'web'
              ? 'App lock (Face ID / fingerprint) is available in the Android and iOS apps.'
              : 'App lock needs a device with biometrics or a passcode enrolled.'}
          </Label>
        )}
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
      <StatementImportForm visible={showImport} onClose={() => setShowImport(false)} />
    </ScrollView>
  );
}
