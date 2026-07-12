import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useStore } from '../store';
import { spacing, type } from '../theme';
import { Amount, Card, Label, Pill, ProgressBar, Row, useTheme } from '../components/ui';
import { AssignForm, EnvelopeForm, MoveMoneyForm } from '../components/forms';
import { assigned, categoryActivity, envelopeAvailable, readyToAssign, totalAssigned } from '../logic/budget';
import { getIndex } from '../logic/derived';
import { addMonths, monthKey, monthLabel } from '../utils/dates';
import { fmt } from '../utils/money';
import { INCOME_CATEGORY_ID } from '../types';

export function BudgetScreen() {
  const t = useTheme();
  const store = useStore();
  const [month, setMonth] = useState(monthKey());
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [editingEnvelope, setEditingEnvelope] = useState<string | null>(null);
  const [showNewEnvelope, setShowNewEnvelope] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const index = getIndex(store);
  const rta = readyToAssign(store, month, index);
  const cats = store.categories.filter((c) => !c.archived && c.id !== INCOME_CATEGORY_ID);
  const groups = [...store.groups].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
        <Pressable onPress={() => { setMonth(addMonths(month, -1)); setNote(null); }} hitSlop={10}>
          <Text style={{ color: t.accent, fontSize: 22 }}>‹</Text>
        </Pressable>
        <Text style={[type.title, { color: t.inkPrimary }]}>{monthLabel(month)}</Text>
        <Pressable onPress={() => { setMonth(addMonths(month, 1)); setNote(null); }} hitSlop={10}>
          <Text style={{ color: t.accent, fontSize: 22 }}>›</Text>
        </Pressable>
      </Row>

      <Card style={{ backgroundColor: rta >= 0 ? t.accentSoft : undefined }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Label>Ready to assign</Label>
            <Amount cents={rta} size="title" colorize={rta < 0} />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Pill label="Move money" onPress={() => setShowMove(true)} />
            <Pill label="+ Envelope" onPress={() => setShowNewEnvelope(true)} />
            <Pill
              label="Copy last month"
              onPress={() => {
                const n = store.copyBudgetFromPreviousMonth(month);
                setNote(n > 0 ? `copied ${n} envelope${n === 1 ? '' : 's'} from last month` : 'nothing new to copy from last month');
              }}
            />
            <Pill
              label="Auto-assign"
              onPress={() => {
                const r = store.autoAssign(month);
                setNote(
                  r.assigned > 0
                    ? `auto-assigned ${fmt(r.assigned)} across ${r.filled} envelope${r.filled === 1 ? '' : 's'}` +
                      (r.shortfall > 0 ? ` · ${fmt(r.shortfall)} short of targets` : '')
                    : r.shortfall > 0
                      ? `nothing to assign · ${fmt(r.shortfall)} short of targets`
                      : 'all targets already funded',
                );
              }}
            />
          </View>
        </Row>
        <Label style={{ marginTop: 4 }}>
          Assigned {fmt(totalAssigned(store, month))} this month · every dollar gets a job
          {note ? ` · ${note}` : ''}
        </Label>
      </Card>

      {groups.map((g) => {
        const groupCats = cats
          .filter((c) => c.groupId === g.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        if (groupCats.length === 0) return null;
        return (
          <View key={g.id} style={{ marginTop: spacing.xl }}>
            <Text style={[type.heading, { color: t.inkSecondary, marginBottom: spacing.sm }]}>
              {g.name}
            </Text>
            <Card style={{ paddingVertical: 4 }}>
              {groupCats.map((c, i) => {
                const asg = assigned(store, c.id, month);
                const activity = categoryActivity(store, c.id, month, index);
                const spentThisMonth = -Math.min(0, activity);
                const avail = envelopeAvailable(store, c, month, index);
                const frac = asg > 0 ? spentThisMonth / asg : spentThisMonth > 0 ? 2 : 0;
                const over = avail < 0;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setAssigningId(c.id)}
                    onLongPress={() => setEditingEnvelope(c.id)}
                    style={{
                      paddingVertical: 12,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: t.gridline,
                    }}
                  >
                    <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={[type.body, { color: t.inkPrimary }]}>
                        {c.emoji} {c.name}
                        {c.rollover ? <Text style={[type.tiny, { color: t.inkMuted }]}>  ↻ rolls over</Text> : null}
                      </Text>
                      <Text style={[type.body, { color: over ? t.critical : t.inkPrimary, fontVariant: ['tabular-nums'] }]}>
                        {fmt(avail)} <Text style={[type.tiny, { color: t.inkMuted }]}>left</Text>
                      </Text>
                    </Row>
                    <ProgressBar fraction={frac} color={t.series[c.colorSlot % t.series.length]} />
                    <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
                      <Label style={{ fontSize: 11 }}>
                        {fmt(spentThisMonth)} of {fmt(asg)} spent
                        {c.monthlyTarget
                          ? asg >= c.monthlyTarget
                            ? '  ·  ✓ target ' + fmt(c.monthlyTarget)
                            : ''
                          : ''}
                      </Label>
                      {over ? (
                        <Text style={[type.tiny, { color: t.critical }]}>⚠ overspent — tap to cover</Text>
                      ) : c.monthlyTarget && asg < c.monthlyTarget ? (
                        <Text style={[type.tiny, { color: t.warning }]}>
                          ▲ {fmt(c.monthlyTarget - asg)} to target
                        </Text>
                      ) : (
                        <Label style={{ fontSize: 11 }}>tap to assign · hold to edit</Label>
                      )}
                    </Row>
                  </Pressable>
                );
              })}
            </Card>
          </View>
        );
      })}

      {assigningId && (
        <AssignForm
          visible={!!assigningId}
          onClose={() => setAssigningId(null)}
          categoryId={assigningId}
          month={month}
          currentAssigned={assigned(store, assigningId, month)}
        />
      )}
      <EnvelopeForm
        visible={showNewEnvelope || !!editingEnvelope}
        onClose={() => { setShowNewEnvelope(false); setEditingEnvelope(null); }}
        editingId={editingEnvelope}
      />
      <MoveMoneyForm visible={showMove} onClose={() => setShowMove(false)} month={month} />
    </ScrollView>
  );
}
