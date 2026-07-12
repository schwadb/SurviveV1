import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Button, Card, Label, Pill, ProgressBar, Row, SectionHeader, useTheme } from '../components/ui';
import * as Crypto from 'expo-crypto';
import { AccountForm, BillForm, ContributeForm, GoalForm, PassphraseSheet, ReconcileForm, RuleForm, StatementImportForm } from '../components/forms';
import { lockAvailable } from '../components/AppLock';
import { accountBalance, clearedBalance, isCredit, netWorth, upcomingBills } from '../logic/budget';
import { getIndex } from '../logic/derived';
import { DebtInput, PayoffStrategy, simulatePayoff } from '../logic/debt';
import { TrendLine } from '../components/charts';
import { Field } from '../components/ui';
import { fmt, parseAmount } from '../utils/money';
import { addMonths, dateLabel, monthKey, monthLabel, todayIso } from '../utils/dates';
import { transactionsToCsv } from '../utils/csv';
import { parseBackup, serializeBackup } from '../utils/backup';
import { decryptBackup, encryptBackup, isEncryptedBackup } from '../utils/cryptoBackup';
import { exportTextFile } from '../utils/share';

const TYPE_LABEL: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash',
  credit: 'Credit Card', investment: 'Investment', loan: 'Loan',
};

function notify(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
  else Alert.alert(title, message);
}

/** Avalanche/snowball payoff planner over credit & loan accounts. */
function DebtPayoffCard() {
  const t = useTheme();
  const store = useStore();
  const index = getIndex(store);
  const { width } = useWindowDimensions();
  const chartW = Math.min(width, 520) - spacing.lg * 4;
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');
  const [extraText, setExtraText] = useState('100');

  const debtAccounts = store.accounts.filter(
    (a) => !a.archived && isCredit(a) && accountBalance(store, a.id, index) < 0,
  );
  if (debtAccounts.length === 0) {
    return (
      <>
        <SectionHeader title="Debt payoff" right={null} />
        <Card>
          <Label>No debt — nice. 🎉 Credit and loan accounts with a negative balance show up here.</Label>
        </Card>
      </>
    );
  }

  const ready = debtAccounts.filter((a) => a.aprBps !== undefined && a.minPayment !== undefined);
  const missing = debtAccounts.filter((a) => a.aprBps === undefined || a.minPayment === undefined);
  const extra = Math.max(0, parseAmount(extraText) ?? 0);
  const inputs: DebtInput[] = ready.map((a) => ({
    id: a.id, name: a.name, balance: -accountBalance(store, a.id, index),
    aprBps: a.aprBps ?? 0, minPayment: a.minPayment ?? 0,
  }));
  const result = inputs.length > 0 ? simulatePayoff(inputs, extra, strategy) : null;
  const other = inputs.length > 0
    ? simulatePayoff(inputs, extra, strategy === 'avalanche' ? 'snowball' : 'avalanche')
    : null;
  const totalDebt = inputs.reduce((a, d) => a + d.balance, 0);

  // TrendLine renders one label per point — sample the curve down to ≤6.
  const curvePoints: number[] = [];
  const curveLabels: string[] = [];
  if (result && result.curve.length >= 2) {
    const step = Math.max(1, Math.ceil(result.curve.length / 5));
    curvePoints.push(totalDebt);
    curveLabels.push('now');
    for (let i = step - 1; i < result.curve.length; i += step) {
      curvePoints.push(result.curve[i]);
      curveLabels.push(`${i + 1}mo`);
    }
    if ((result.curve.length - 1) % step !== step - 1) {
      curvePoints.push(result.curve[result.curve.length - 1]);
      curveLabels.push(`${result.curve.length}mo`);
    }
  }

  return (
    <>
      <SectionHeader title="Debt payoff" right={null} />
      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <Label>Total debt</Label>
          <Amount cents={-totalDebt} size="heading" colorize />
        </Row>
        <Row style={{ gap: spacing.sm, marginBottom: spacing.md }}>
          <Pill label="Avalanche · highest APR first" active={strategy === 'avalanche'} onPress={() => setStrategy('avalanche')} />
          <Pill label="Snowball · smallest first" active={strategy === 'snowball'} onPress={() => setStrategy('snowball')} />
        </Row>
        <Field label="Extra payment per month" value={extraText} onChangeText={setExtraText} keyboardType="decimal-pad" placeholder="100.00" />
        {result && !result.neverPaysOff && (
          <>
            <Row style={{ justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <View>
                <Label>Debt-free</Label>
                <Text style={[type.heading, { color: t.inkPrimary }]}>
                  {monthLabel(addMonths(monthKey(), result.months))}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Label>Total interest</Label>
                <Text style={[type.heading, { color: t.inkPrimary, fontVariant: ['tabular-nums'] }]}>
                  {fmt(result.totalInterest)}
                </Text>
              </View>
            </Row>
            {other && !other.neverPaysOff && other.totalInterest !== result.totalInterest && (
              <Label style={{ marginBottom: spacing.sm }}>
                {result.totalInterest <= other.totalInterest
                  ? `${strategy} saves ${fmt(other.totalInterest - result.totalInterest)} vs ${strategy === 'avalanche' ? 'snowball' : 'avalanche'}`
                  : `${strategy === 'avalanche' ? 'snowball' : 'avalanche'} would save ${fmt(result.totalInterest - other.totalInterest)}`}
              </Label>
            )}
            {curvePoints.length >= 2 && (
              <TrendLine points={curvePoints} labels={curveLabels} width={chartW} color={t.series[0]} />
            )}
            <Label style={{ marginTop: spacing.sm, fontSize: 11 }}>
              Assumes no new spending on these accounts.
            </Label>
          </>
        )}
        {result?.neverPaysOff && (
          <Text style={[type.caption, { color: t.critical }]}>
            ⚠ These payments never pay off the balance — interest outruns them. Raise the
            minimums or the extra payment.
          </Text>
        )}
        {missing.length > 0 && (
          <Label style={{ marginTop: spacing.sm }}>
            ⚠ APR needed: add APR and minimum payment to {missing.map((a) => a.name).join(', ')} (tap
            the account above) to include {missing.length === 1 ? 'it' : 'them'} in the plan.
          </Label>
        )}
      </Card>
    </>
  );
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
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ name: string; text: string } | null>(null);
  const [showEncryptSheet, setShowEncryptSheet] = useState(false);
  const [pendingDecrypt, setPendingDecrypt] = useState<{ name: string; text: string } | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);

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
      if (isEncryptedBackup(text)) {
        setDecryptError(null);
        setPendingDecrypt({ name: asset.name, text });
        return;
      }
      const { error } = parseBackup(text);
      if (error) return notify('Cannot restore', error);
      setPendingRestore({ name: asset.name, text });
    } catch (e) {
      notify('Could not read file', e instanceof Error ? e.message : 'Unknown error.');
    }
  };

  const exportEncrypted = (passphrase: string) => {
    setShowEncryptSheet(false);
    const cipherText = encryptBackup(
      serializeBackup(store, new Date().toISOString()),
      passphrase,
      (n) => Crypto.getRandomBytes(n),
    );
    void exportTextFile(`survive-budget-backup-${todayIso()}.enc.json`, 'application/json', cipherText);
  };

  const unlockAndStage = (passphrase: string) => {
    if (!pendingDecrypt) return;
    const { json, error } = decryptBackup(pendingDecrypt.text, passphrase);
    if (error || !json) {
      setDecryptError(error ?? 'Could not decrypt.');
      return;
    }
    const parsed = parseBackup(json);
    if (parsed.error) {
      setDecryptError(parsed.error);
      return;
    }
    // Decryption proves authenticity; the pendingRestore confirm step below
    // is still required before anything is overwritten.
    setPendingRestore({ name: pendingDecrypt.name, text: json });
    setPendingDecrypt(null);
    setDecryptError(null);
  };

  const index = getIndex(store);
  const nw = netWorth(store, index);
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
          const bal = accountBalance(store, a.id, index);
          const cleared = clearedBalance(store, a.id, index);
          const hasPending = cleared !== bal;
          return (
            <Pressable
              key={a.id}
              onPress={() => setAccountForm({ open: true, id: a.id })}
              onLongPress={() => setReconcileId(a.id)}
              style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.gridline }}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: t.inkPrimary }]}>{a.name}</Text>
                  <Label>
                    {TYPE_LABEL[a.type]}{a.onBudget ? ' · on budget' : ' · tracking'} · tap to edit
                  </Label>
                </View>
                <Row style={{ gap: spacing.sm }}>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Amount cents={bal} colorize={bal < 0} />
                    {hasPending ? (
                      <Label style={{ fontSize: 11 }}>cleared {fmt(cleared)}</Label>
                    ) : null}
                  </View>
                  <Pill label="Reconcile" onPress={() => setReconcileId(a.id)} />
                </Row>
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

      <DebtPayoffCard />

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
          <Button title="Export encrypted backup (AES-256)" variant="ghost" onPress={() => setShowEncryptSheet(true)} />
        </View>
        <Label style={{ marginTop: spacing.md }}>
          🔒 Privacy-first: all data lives on this device. No bank logins, no cloud, no ads.
          Backup files are unencrypted — store them somewhere safe.
        </Label>
      </Card>

      <SectionHeader title="Notifications" right={null} />
      <Card>
        {Platform.OS === 'web' ? (
          <Label>Bill reminders are available in the Android and iOS apps.</Label>
        ) : (
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={[type.body, { color: t.inkPrimary }]}>Bill reminders</Text>
              <Label>Notify at 9:00 on due dates, plus 3 days ahead for bills without autopay</Label>
            </View>
            <Switch
              value={store.settings.billReminders ?? false}
              onValueChange={async (v) => {
                if (v) {
                  const { ensureNotificationPermissions } = await import('../services/notifications');
                  const ok = await ensureNotificationPermissions();
                  if (!ok) {
                    notify(
                      'Notifications disabled',
                      'Enable notifications for Survive Budget in system settings, then try again.',
                    );
                    return;
                  }
                }
                store.updateSettings({ billReminders: v });
              }}
              trackColor={{ true: t.good }}
            />
          </Row>
        )}
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
            {/* Testing utility: loads demo + ~10k synthetic transactions to
                exercise the app at scale. Not __DEV__-gated so it survives the
                production web export the e2e scale drive runs against; it only
                loads demo data, so it is safer than the two buttons above. */}
            <Button title="Load 10k demo transactions (testing)" variant="ghost" onPress={() => store.loadLargeDemo()} />
          </View>
        )}
      </Card>

      <AccountForm visible={accountForm.open} onClose={() => setAccountForm({ open: false, id: null })} editingId={accountForm.id} />
      <ReconcileForm visible={!!reconcileId} onClose={() => setReconcileId(null)} accountId={reconcileId} />
      <GoalForm visible={goalForm.open} onClose={() => setGoalForm({ open: false, id: null })} editingId={goalForm.id} />
      <ContributeForm visible={!!contributeId} onClose={() => setContributeId(null)} goalId={contributeId} />
      <BillForm visible={billForm.open} onClose={() => setBillForm({ open: false, id: null })} editingId={billForm.id} />
      <RuleForm visible={showRuleForm} onClose={() => setShowRuleForm(false)} />
      <StatementImportForm visible={showImport} onClose={() => setShowImport(false)} />
      <PassphraseSheet
        visible={showEncryptSheet}
        mode="export"
        onClose={() => setShowEncryptSheet(false)}
        onSubmit={exportEncrypted}
      />
      <PassphraseSheet
        visible={!!pendingDecrypt}
        mode="restore"
        onClose={() => { setPendingDecrypt(null); setDecryptError(null); }}
        onSubmit={unlockAndStage}
        error={decryptError}
      />
    </ScrollView>
  );
}
