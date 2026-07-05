import React, { useMemo, useState } from 'react';
import { Alert, Platform, Switch, Text, View } from 'react-native';
import { useStore } from '../store';
import { INCOME_CATEGORY_ID, Transaction } from '../types';
import { parseAmount } from '../utils/money';
import { todayIso } from '../utils/dates';
import { parseTransactionsCsv } from '../utils/csv';
import { Button, ChipPicker, Field, Label, Row, Sheet, useTheme } from './ui';
import { spacing, type } from '../theme';

function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    // RN Alert is a no-op on web.
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export function TransactionForm({
  visible, onClose, editing,
}: { visible: boolean; onClose: () => void; editing?: Transaction | null }) {
  const store = useStore();
  const t = useTheme();
  const isEdit = !!editing;

  const [payee, setPayee] = useState(editing?.payee ?? '');
  const [amountText, setAmountText] = useState(
    editing ? (Math.abs(editing.amount) / 100).toFixed(2) : '',
  );
  const [isIncome, setIsIncome] = useState(editing ? editing.amount > 0 : false);
  const [date, setDate] = useState(editing?.date ?? todayIso());
  const [accountId, setAccountId] = useState(editing?.accountId ?? store.accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null);
  const [note, setNote] = useState(editing?.note ?? '');

  // Re-seed local state when a different transaction is opened.
  const [seedKey, setSeedKey] = useState(editing?.id ?? 'new');
  const currentKey = editing?.id ?? 'new';
  if (seedKey !== currentKey) {
    setSeedKey(currentKey);
    setPayee(editing?.payee ?? '');
    setAmountText(editing ? (Math.abs(editing.amount) / 100).toFixed(2) : '');
    setIsIncome(editing ? editing.amount > 0 : false);
    setDate(editing?.date ?? todayIso());
    setAccountId(editing?.accountId ?? store.accounts[0]?.id ?? '');
    setCategoryId(editing?.categoryId ?? null);
    setNote(editing?.note ?? '');
  }

  const categories = store.categories.filter((c) => !c.archived);
  const accounts = store.accounts.filter((a) => !a.archived);

  const save = () => {
    const cents = parseAmount(amountText);
    if (!payee.trim()) return notify('Missing payee', 'Enter who this transaction was with.');
    if (cents === null || cents === 0) return notify('Bad amount', 'Enter an amount like 12.34.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return notify('Bad date', 'Use yyyy-mm-dd format.');
    if (!accountId) return notify('No account', 'Add an account first (More → Accounts).');
    const amount = isIncome ? Math.abs(cents) : -Math.abs(cents);
    const catId = isIncome ? INCOME_CATEGORY_ID : categoryId;
    if (isEdit && editing) {
      store.updateTransaction(editing.id, { payee: payee.trim(), amount, date, accountId, categoryId: catId, note: note.trim() || undefined });
    } else {
      store.addTransaction({ payee: payee.trim(), amount, date, accountId, categoryId: catId, note: note.trim() || undefined, cleared: false });
    }
    onClose();
  };

  const remove = () => {
    if (editing) store.deleteTransaction(editing.id);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={isEdit ? 'Edit Transaction' : 'Add Transaction'}>
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
        <Label>{isIncome ? 'Income (money in)' : 'Expense (money out)'}</Label>
        <Switch value={isIncome} onValueChange={setIsIncome} trackColor={{ true: t.good }} />
      </Row>
      <Field label="Payee" value={payee} onChangeText={setPayee} placeholder="Fresh Market" autoFocus={!isEdit} />
      <Field label="Amount" value={amountText} onChangeText={setAmountText} placeholder="12.34" keyboardType="decimal-pad" />
      <Field label="Date (yyyy-mm-dd)" value={date} onChangeText={setDate} placeholder={todayIso()} />
      <Label style={{ marginBottom: 4 }}>Account</Label>
      <ChipPicker items={accounts} selectedId={accountId} onSelect={setAccountId} labelFor={(a) => a.name} />
      {!isIncome && (
        <>
          <Label style={{ marginBottom: 4 }}>
            Category {categoryId === null ? '(leave blank to auto-categorize by rules)' : ''}
          </Label>
          <ChipPicker
            items={categories.filter((c) => c.id !== INCOME_CATEGORY_ID)}
            selectedId={categoryId}
            onSelect={(id) => setCategoryId(id === categoryId ? null : id)}
            labelFor={(c) => `${c.emoji} ${c.name}`}
          />
        </>
      )}
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="" />
      <Button title={isEdit ? 'Save Changes' : 'Add Transaction'} onPress={save} />
      {isEdit && (
        <View style={{ marginTop: spacing.sm }}>
          <Button title="Delete" variant="danger" onPress={remove} />
        </View>
      )}
    </Sheet>
  );
}

export function EnvelopeForm({
  visible, onClose, editingId,
}: { visible: boolean; onClose: () => void; editingId?: string | null }) {
  const store = useStore();
  const editing = store.categories.find((c) => c.id === editingId);
  const t = useTheme();

  const [name, setName] = useState(editing?.name ?? '');
  const [emoji, setEmoji] = useState(editing?.emoji ?? '📦');
  const [groupId, setGroupId] = useState(editing?.groupId ?? store.groups[0]?.id ?? '');
  const [rollover, setRollover] = useState(editing?.rollover ?? false);

  const [seedKey, setSeedKey] = useState(editingId ?? 'new');
  const currentKey = editingId ?? 'new';
  if (seedKey !== currentKey) {
    setSeedKey(currentKey);
    setName(editing?.name ?? '');
    setEmoji(editing?.emoji ?? '📦');
    setGroupId(editing?.groupId ?? store.groups[0]?.id ?? '');
    setRollover(editing?.rollover ?? false);
  }

  const save = () => {
    if (!name.trim()) return notify('Missing name', 'Give the envelope a name.');
    if (editing) {
      store.updateCategory(editing.id, { name: name.trim(), emoji: emoji.trim() || '📦', groupId, rollover });
    } else {
      const used = new Set(store.categories.map((c) => c.colorSlot));
      let slot = 0;
      while (used.has(slot) && slot < 7) slot++;
      store.addCategory({
        name: name.trim(), emoji: emoji.trim() || '📦', groupId, rollover,
        colorSlot: slot, sortOrder: store.categories.length,
      });
    }
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit Envelope' : 'New Envelope'}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Groceries" autoFocus />
      <Field label="Emoji" value={emoji} onChangeText={setEmoji} placeholder="🛒" />
      <Label style={{ marginBottom: 4 }}>Group</Label>
      <ChipPicker items={store.groups} selectedId={groupId} onSelect={setGroupId} labelFor={(g) => g.name} />
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.lg }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={[type.body, { color: t.inkPrimary }]}>Rollover</Text>
          <Label>Unspent money carries into next month (Goodbudget-style envelope)</Label>
        </View>
        <Switch value={rollover} onValueChange={setRollover} trackColor={{ true: t.good }} />
      </Row>
      <Button title={editing ? 'Save' : 'Create Envelope'} onPress={save} />
      {editing && !editing.archived && (
        <View style={{ marginTop: spacing.sm }}>
          <Button
            title="Archive"
            variant="ghost"
            onPress={() => {
              store.updateCategory(editing.id, { archived: true });
              onClose();
            }}
          />
        </View>
      )}
    </Sheet>
  );
}

export function AssignForm({
  visible, onClose, categoryId, month, currentAssigned,
}: { visible: boolean; onClose: () => void; categoryId: string; month: string; currentAssigned: number }) {
  const store = useStore();
  const cat = store.categories.find((c) => c.id === categoryId);
  const [text, setText] = useState((currentAssigned / 100).toFixed(2));

  const [seedKey, setSeedKey] = useState(`${categoryId}-${month}`);
  if (seedKey !== `${categoryId}-${month}`) {
    setSeedKey(`${categoryId}-${month}`);
    setText((currentAssigned / 100).toFixed(2));
  }

  const save = () => {
    const cents = parseAmount(text);
    if (cents === null || cents < 0) return notify('Bad amount', 'Enter an amount like 250.00.');
    store.assign(month, categoryId, cents);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`Assign to ${cat?.emoji ?? ''} ${cat?.name ?? ''}`}>
      <Field label="Assigned this month" value={text} onChangeText={setText} keyboardType="decimal-pad" autoFocus />
      <Button title="Save" onPress={save} />
    </Sheet>
  );
}

export function MoveMoneyForm({
  visible, onClose, month,
}: { visible: boolean; onClose: () => void; month: string }) {
  const store = useStore();
  const cats = store.categories.filter((c) => !c.archived && c.id !== INCOME_CATEGORY_ID);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [text, setText] = useState('');

  const save = () => {
    const cents = parseAmount(text);
    if (!fromId || !toId || fromId === toId) return notify('Pick envelopes', 'Choose two different envelopes.');
    if (cents === null || cents <= 0) return notify('Bad amount', 'Enter a positive amount.');
    store.moveMoney(month, fromId, toId, cents);
    onClose();
    setText('');
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Move Money">
      <Label style={{ marginBottom: 4 }}>From</Label>
      <ChipPicker items={cats} selectedId={fromId} onSelect={setFromId} labelFor={(c) => `${c.emoji} ${c.name}`} />
      <Label style={{ marginBottom: 4 }}>To</Label>
      <ChipPicker items={cats} selectedId={toId} onSelect={setToId} labelFor={(c) => `${c.emoji} ${c.name}`} />
      <Field label="Amount" value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="50.00" />
      <Button title="Move" onPress={save} />
    </Sheet>
  );
}

export function AccountForm({
  visible, onClose, editingId,
}: { visible: boolean; onClose: () => void; editingId?: string | null }) {
  const store = useStore();
  const t = useTheme();
  const editing = store.accounts.find((a) => a.id === editingId);
  const [name, setName] = useState(editing?.name ?? '');
  const [balanceText, setBalanceText] = useState(editing ? (editing.openingBalance / 100).toFixed(2) : '');
  const [accountType, setAccountType] = useState(editing?.type ?? 'checking');
  const [onBudget, setOnBudget] = useState(editing?.onBudget ?? true);

  const [seedKey, setSeedKey] = useState(editingId ?? 'new');
  const currentKey = editingId ?? 'new';
  if (seedKey !== currentKey) {
    setSeedKey(currentKey);
    setName(editing?.name ?? '');
    setBalanceText(editing ? (editing.openingBalance / 100).toFixed(2) : '');
    setAccountType(editing?.type ?? 'checking');
    setOnBudget(editing?.onBudget ?? true);
  }

  const types = [
    { id: 'checking', label: 'Checking' }, { id: 'savings', label: 'Savings' },
    { id: 'cash', label: 'Cash' }, { id: 'credit', label: 'Credit Card' },
    { id: 'investment', label: 'Investment' }, { id: 'loan', label: 'Loan' },
  ] as const;

  const save = () => {
    const cents = parseAmount(balanceText || '0');
    if (!name.trim()) return notify('Missing name', 'Give the account a name.');
    if (cents === null) return notify('Bad balance', 'Enter a starting balance like 1500.00 (negative for debt).');
    if (editing) {
      store.updateAccount(editing.id, { name: name.trim(), openingBalance: cents, type: accountType, onBudget });
    } else {
      store.addAccount({ name: name.trim(), openingBalance: cents, type: accountType, onBudget });
    }
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit Account' : 'Add Account'}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Everyday Checking" autoFocus />
      <Field label={editing ? 'Opening balance' : 'Current balance'} value={balanceText} onChangeText={setBalanceText} keyboardType="decimal-pad" placeholder="1500.00" />
      <Label style={{ marginBottom: 4 }}>Type</Label>
      <ChipPicker
        items={types.map((x) => ({ id: x.id }))}
        selectedId={accountType}
        onSelect={(id) => setAccountType(id as typeof accountType)}
        labelFor={(item) => types.find((x) => x.id === item.id)?.label ?? item.id}
      />
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.lg }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={[type.body, { color: t.inkPrimary }]}>On budget</Text>
          <Label>Counts toward Ready to Assign and In My Pocket</Label>
        </View>
        <Switch value={onBudget} onValueChange={setOnBudget} trackColor={{ true: t.good }} />
      </Row>
      <Button title={editing ? 'Save' : 'Add Account'} onPress={save} />
    </Sheet>
  );
}

export function GoalForm({
  visible, onClose, editingId,
}: { visible: boolean; onClose: () => void; editingId?: string | null }) {
  const store = useStore();
  const editing = store.goals.find((g) => g.id === editingId);
  const [name, setName] = useState(editing?.name ?? '');
  const [emoji, setEmoji] = useState(editing?.emoji ?? '🎯');
  const [targetText, setTargetText] = useState(editing ? (editing.target / 100).toFixed(2) : '');

  const [seedKey, setSeedKey] = useState(editingId ?? 'new');
  const currentKey = editingId ?? 'new';
  if (seedKey !== currentKey) {
    setSeedKey(currentKey);
    setName(editing?.name ?? '');
    setEmoji(editing?.emoji ?? '🎯');
    setTargetText(editing ? (editing.target / 100).toFixed(2) : '');
  }

  const save = () => {
    const target = parseAmount(targetText);
    if (!name.trim()) return notify('Missing name', 'Give the goal a name.');
    if (target === null || target <= 0) return notify('Bad target', 'Enter a target like 5000.00.');
    if (editing) {
      store.updateGoal(editing.id, { name: name.trim(), emoji: emoji.trim() || '🎯', target });
    } else {
      store.addGoal({
        name: name.trim(), emoji: emoji.trim() || '🎯', target, saved: 0,
        colorSlot: store.goals.length % 8,
      });
    }
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit Goal' : 'New Savings Goal'}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Emergency Fund" autoFocus />
      <Field label="Emoji" value={emoji} onChangeText={setEmoji} placeholder="🛟" />
      <Field label="Target amount" value={targetText} onChangeText={setTargetText} keyboardType="decimal-pad" placeholder="10000.00" />
      <Button title={editing ? 'Save' : 'Create Goal'} onPress={save} />
      {editing && (
        <View style={{ marginTop: spacing.sm }}>
          <Button title="Delete Goal" variant="danger" onPress={() => { store.deleteGoal(editing.id); onClose(); }} />
        </View>
      )}
    </Sheet>
  );
}

export function ContributeForm({
  visible, onClose, goalId,
}: { visible: boolean; onClose: () => void; goalId: string | null }) {
  const store = useStore();
  const goal = store.goals.find((g) => g.id === goalId);
  const [text, setText] = useState('');
  const save = (dir: 1 | -1) => {
    const cents = parseAmount(text);
    if (!goal || cents === null || cents <= 0) return notify('Bad amount', 'Enter a positive amount.');
    store.contributeToGoal(goal.id, cents * dir);
    setText('');
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={`${goal?.emoji ?? ''} ${goal?.name ?? 'Goal'}`}>
      <Field label="Amount" value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="100.00" autoFocus />
      <Button title="Add to Goal" onPress={() => save(1)} />
      <View style={{ marginTop: spacing.sm }}>
        <Button title="Withdraw" variant="ghost" onPress={() => save(-1)} />
      </View>
    </Sheet>
  );
}

export function BillForm({
  visible, onClose, editingId,
}: { visible: boolean; onClose: () => void; editingId?: string | null }) {
  const store = useStore();
  const t = useTheme();
  const editing = store.bills.find((b) => b.id === editingId);
  const [name, setName] = useState(editing?.name ?? '');
  const [amountText, setAmountText] = useState(editing ? (editing.amount / 100).toFixed(2) : '');
  const [dueDayText, setDueDayText] = useState(editing ? String(editing.dueDay) : '1');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null);
  const [autopay, setAutopay] = useState(editing?.autopay ?? false);

  const [seedKey, setSeedKey] = useState(editingId ?? 'new');
  const currentKey = editingId ?? 'new';
  if (seedKey !== currentKey) {
    setSeedKey(currentKey);
    setName(editing?.name ?? '');
    setAmountText(editing ? (editing.amount / 100).toFixed(2) : '');
    setDueDayText(editing ? String(editing.dueDay) : '1');
    setCategoryId(editing?.categoryId ?? null);
    setAutopay(editing?.autopay ?? false);
  }

  const save = () => {
    const cents = parseAmount(amountText);
    const dueDay = Number(dueDayText);
    if (!name.trim()) return notify('Missing name', 'Give the bill a name.');
    if (cents === null || cents <= 0) return notify('Bad amount', 'Enter a positive amount.');
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
      return notify('Bad due day', 'Due day must be 1-28.');
    }
    if (editing) {
      store.updateBill(editing.id, { name: name.trim(), amount: cents, dueDay, categoryId, autopay });
    } else {
      store.addBill({ name: name.trim(), amount: cents, dueDay, categoryId, autopay, paidMonths: [] });
    }
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit Bill' : 'Add Recurring Bill'}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Rent" autoFocus />
      <Field label="Amount" value={amountText} onChangeText={setAmountText} keyboardType="decimal-pad" placeholder="1650.00" />
      <Field label="Due day of month (1-28)" value={dueDayText} onChangeText={setDueDayText} keyboardType="numeric" />
      <Label style={{ marginBottom: 4 }}>Envelope (optional)</Label>
      <ChipPicker
        items={store.categories.filter((c) => !c.archived && c.id !== INCOME_CATEGORY_ID)}
        selectedId={categoryId}
        onSelect={(id) => setCategoryId(id === categoryId ? null : id)}
        labelFor={(c) => `${c.emoji} ${c.name}`}
      />
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.lg }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={[type.body, { color: t.inkPrimary }]}>Autopay</Text>
          <Label>Paid automatically — shown for awareness, no reminder urgency</Label>
        </View>
        <Switch value={autopay} onValueChange={setAutopay} trackColor={{ true: t.good }} />
      </Row>
      <Button title={editing ? 'Save' : 'Add Bill'} onPress={save} />
      {editing && (
        <View style={{ marginTop: spacing.sm }}>
          <Button title="Delete Bill" variant="danger" onPress={() => { store.deleteBill(editing.id); onClose(); }} />
        </View>
      )}
    </Sheet>
  );
}

export function RuleForm({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const store = useStore();
  const [match, setMatch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const save = () => {
    if (!match.trim() || !categoryId) return notify('Incomplete', 'Enter match text and pick a category.');
    store.addRule({ match: match.trim(), categoryId });
    setMatch('');
    setCategoryId(null);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="New Auto-Categorize Rule">
      <Field label='If payee contains…' value={match} onChangeText={setMatch} placeholder="starbucks" autoFocus />
      <Label style={{ marginBottom: 4 }}>…assign category</Label>
      <ChipPicker
        items={store.categories.filter((c) => !c.archived || c.id === INCOME_CATEGORY_ID)}
        selectedId={categoryId}
        onSelect={setCategoryId}
        labelFor={(c) => `${c.emoji} ${c.name}`}
      />
      <Button title="Add Rule" onPress={save} />
    </Sheet>
  );
}

export function CsvImportForm({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const store = useStore();
  const [text, setText] = useState('');
  const accounts = store.accounts.filter((a) => !a.archived);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');

  const preview = useMemo(() => (text.trim() ? parseTransactionsCsv(text) : null), [text]);

  const doImport = () => {
    if (!preview || preview.rows.length === 0) return notify('Nothing to import', 'Paste CSV with date, payee, amount columns.');
    if (!accountId) return notify('No account', 'Pick an account for the imported transactions.');
    const byName = new Map(store.categories.map((c) => [c.name.toLowerCase(), c.id]));
    const count = store.importTransactions(
      preview.rows.map((r) => ({
        date: r.date, payee: r.payee, amount: r.amount, accountId,
        categoryId: r.categoryName ? byName.get(r.categoryName.toLowerCase()) ?? null : null,
      })),
    );
    setText('');
    onClose();
    notify('Import complete', `Imported ${count} transactions.`);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Import CSV">
      <Label style={{ marginBottom: spacing.sm }}>
        Paste bank-export CSV. Needs a header row with date, payee/description and amount
        (negative = spending). Optional category column.
      </Label>
      <Label style={{ marginBottom: 4 }}>Into account</Label>
      <ChipPicker items={accounts} selectedId={accountId} onSelect={setAccountId} labelFor={(a) => a.name} />
      <Field label="CSV text" value={text} onChangeText={setText} multiline placeholder={'date,payee,amount\n2026-07-01,Coffee,-4.50'} />
      {preview && (
        <Label style={{ marginBottom: spacing.md }}>
          {preview.rows.length} rows ready
          {preview.errors.length > 0 ? ` · ${preview.errors.length} skipped (${preview.errors[0]})` : ''}
        </Label>
      )}
      <Button title="Import" onPress={doImport} disabled={!preview || preview.rows.length === 0} />
    </Sheet>
  );
}
