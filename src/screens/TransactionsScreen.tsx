import React, { useDeferredValue, useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, Text, TextInput, View, StyleSheet } from 'react-native';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Label, Pill, Row, useTheme, EmptyState } from '../components/ui';
import { TransactionForm } from '../components/forms';
import { sortTransactions } from '../logic/budget';
import { dateLabel } from '../utils/dates';
import { INCOME_CATEGORY_ID, Transaction } from '../types';

interface Section {
  date: string;
  data: Transaction[];
}

/** True when the transaction (or any split leg) is in the given category. */
function matchesCategory(tx: Transaction, categoryId: string): boolean {
  if (categoryId === 'uncategorized') {
    if (tx.splits && tx.splits.length > 0) return tx.splits.some((s) => s.categoryId === null);
    return tx.categoryId === null;
  }
  if (tx.splits && tx.splits.length > 0) return tx.splits.some((s) => s.categoryId === categoryId);
  return tx.categoryId === categoryId;
}

export function TransactionsScreen() {
  const t = useTheme();
  const store = useStore();
  const [query, setQuery] = useState('');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [filterAcct, setFilterAcct] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Keep the input instant; let the (expensive) filtering lag one commit so
  // typing never stutters against a large transaction list.
  const deferredQuery = useDeferredValue(query);

  const uncategorizedCount = useMemo(
    () =>
      store.transactions.filter((tx) =>
        tx.splits && tx.splits.length > 0
          ? tx.splits.some((s) => s.categoryId === null)
          : tx.categoryId === null,
      ).length,
    [store.transactions],
  );

  const sections = useMemo<Section[]>(() => {
    const q = deferredQuery.trim().toLowerCase();
    const catName = new Map(store.categories.map((c) => [c.id, c.name.toLowerCase()]));
    const filtered = sortTransactions(store.transactions).filter((tx) => {
      if (filterCat && !matchesCategory(tx, filterCat)) return false;
      if (filterAcct && tx.accountId !== filterAcct) return false;
      if (!q) return true;
      if (tx.payee.toLowerCase().includes(q)) return true;
      if ((tx.note ?? '').toLowerCase().includes(q)) return true;
      const cid = tx.categoryId;
      return cid ? (catName.get(cid)?.includes(q) ?? false) : false;
    });
    const out: Section[] = [];
    for (const tx of filtered) {
      const last = out[out.length - 1];
      if (last && last.date === tx.date) last.data.push(tx);
      else out.push({ date: tx.date, data: [tx] });
    }
    return out;
  }, [store.transactions, store.categories, deferredQuery, filterCat, filterAcct]);

  const catFor = (tx: Transaction) => store.categories.find((c) => c.id === tx.categoryId);
  const acctFor = (tx: Transaction) => store.accounts.find((a) => a.id === tx.accountId);

  const categoryLabel = (tx: Transaction): string => {
    if (tx.splits && tx.splits.length > 0) return `🔀 Split · ${tx.splits.length} categories`;
    if (tx.categoryId === INCOME_CATEGORY_ID) return '💰 Income';
    const cat = catFor(tx);
    return cat ? `${cat.emoji} ${cat.name}` : '❓ Uncategorized';
  };

  const renderItem = ({ item: tx }: { item: Transaction }) => (
    <Pressable
      onPress={() => setEditing(tx)}
      style={{
        backgroundColor: t.surface, paddingVertical: 10, paddingHorizontal: spacing.lg,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gridline,
      }}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={[type.body, { color: t.inkPrimary }]} numberOfLines={1}>
            {tx.payee}
            {!tx.cleared ? <Text style={[type.tiny, { color: t.warning }]}>  ● pending</Text> : null}
          </Text>
          <Label>
            {categoryLabel(tx)}
            {' · '}{acctFor(tx)?.name ?? 'Unknown account'}
          </Label>
        </View>
        <Amount cents={tx.amount} colorize={tx.amount > 0} sign={tx.amount > 0} />
      </Row>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
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
            {uncategorizedCount > 0 && (
              <Pill
                label={`❓ Uncategorized · ${uncategorizedCount}`}
                tone="warning"
                active={filterCat === 'uncategorized'}
                onPress={() => setFilterCat(filterCat === 'uncategorized' ? null : 'uncategorized')}
              />
            )}
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

      {sections.length === 0 ? (
        <EmptyState emoji="🔍" title="No transactions" subtitle="Try a different search or add your first transaction." />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(tx) => tx.id}
          renderItem={renderItem}
          stickySectionHeadersEnabled={false}
          initialNumToRender={20}
          windowSize={11}
          removeClippedSubviews
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
          renderSectionHeader={({ section }) => (
            <Label style={{ marginTop: spacing.md, marginBottom: 6 }}>{dateLabel(section.date)}</Label>
          )}
        />
      )}

      <TransactionForm
        visible={showAdd || !!editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        editing={editing}
      />
    </View>
  );
}
