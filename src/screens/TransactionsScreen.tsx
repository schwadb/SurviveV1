import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Card, Label, Pill, Row, useTheme, EmptyState } from '../components/ui';
import { TransactionForm } from '../components/forms';
import { sortTransactions } from '../logic/budget';
import { dateLabel } from '../utils/dates';
import { INCOME_CATEGORY_ID, Transaction } from '../types';

export function TransactionsScreen() {
  const t = useTheme();
  const store = useStore();
  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [filterAcct, setFilterAcct] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortTransactions(store.transactions).filter((tx) => {
      if (filterCat && tx.categoryId !== filterCat) return false;
      if (filterAcct && tx.accountId !== filterAcct) return false;
      if (!q) return true;
      const cat = store.categories.find((c) => c.id === tx.categoryId);
      return (
        tx.payee.toLowerCase().includes(q) ||
        (tx.note ?? '').toLowerCase().includes(q) ||
        (cat?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [store.transactions, store.categories, query, filterCat, filterAcct]);

  // Group by date for section headers.
  const groups = useMemo(() => {
    const out: { date: string; items: Transaction[] }[] = [];
    for (const tx of filtered) {
      const last = out[out.length - 1];
      if (last && last.date === tx.date) last.items.push(tx);
      else out.push({ date: tx.date, items: [tx] });
    }
    return out;
  }, [filtered]);

  const catFor = (tx: Transaction) => store.categories.find((c) => c.id === tx.categoryId);
  const acctFor = (tx: Transaction) => store.accounts.find((a) => a.id === tx.accountId);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
          <Text style={[type.title, { color: t.inkPrimary }]}>Transactions</Text>
          <Pill label="+ Add" active onPress={() => setShowAdd(true)} />
        </Row>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search payee, note, category…"
          placeholderTextColor={t.inkMuted}
          style={{
            backgroundColor: t.surface, color: t.inkPrimary, borderRadius: 12,
            paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 15,
            borderWidth: StyleSheet.hairlineWidth, borderColor: t.border,
          }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          <Row style={{ gap: spacing.sm }}>
            {store.accounts.filter((a) => !a.archived).map((a) => (
              <Pill
                key={a.id}
                label={a.name}
                active={filterAcct === a.id}
                onPress={() => setFilterAcct(filterAcct === a.id ? null : a.id)}
              />
            ))}
            {store.categories.filter((c) => !c.archived).map((c) => (
              <Pill
                key={c.id}
                label={`${c.emoji} ${c.name}`}
                active={filterCat === c.id}
                onPress={() => setFilterCat(filterCat === c.id ? null : c.id)}
              />
            ))}
          </Row>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        {groups.length === 0 ? (
          <EmptyState emoji="🔍" title="No transactions" subtitle="Try a different search or add your first transaction." />
        ) : (
          groups.map((g) => (
            <View key={g.date} style={{ marginBottom: spacing.md }}>
              <Label style={{ marginBottom: 6 }}>{dateLabel(g.date)}</Label>
              <Card style={{ paddingVertical: 2 }}>
                {g.items.map((tx, i) => {
                  const cat = catFor(tx);
                  const isIncome = tx.categoryId === INCOME_CATEGORY_ID || tx.amount > 0;
                  return (
                    <Pressable
                      key={tx.id}
                      onPress={() => setEditing(tx)}
                      style={{
                        paddingVertical: 10,
                        borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.gridline,
                      }}
                    >
                      <Row style={{ justifyContent: 'space-between' }}>
                        <View style={{ flex: 1, paddingRight: spacing.md }}>
                          <Text style={[type.body, { color: t.inkPrimary }]} numberOfLines={1}>
                            {tx.payee}
                            {!tx.cleared ? <Text style={[type.tiny, { color: t.warning }]}>  ● pending</Text> : null}
                          </Text>
                          <Label>
                            {isIncome ? '💰 Income' : cat ? `${cat.emoji} ${cat.name}` : '❓ Uncategorized'}
                            {' · '}{acctFor(tx)?.name ?? 'Unknown account'}
                          </Label>
                        </View>
                        <Amount cents={tx.amount} colorize={tx.amount > 0} sign={tx.amount > 0} />
                      </Row>
                    </Pressable>
                  );
                })}
              </Card>
            </View>
          ))
        )}
      </ScrollView>

      <TransactionForm
        visible={showAdd || !!editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        editing={editing}
      />
    </View>
  );
}
