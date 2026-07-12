import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { useTheme } from './ui';
import { type } from '../theme';
import { fmtShort } from '../utils/money';

// Chart mark specs: 2px lines, thin bars with 4px rounded data-ends anchored
// to the baseline, 2px surface gaps between adjacent fills, direct labels in
// ink (never series color), recessive hairline grid.

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Category spending donut with center total and tap-to-inspect slices. */
export function Donut({
  slices, size = 180, centerLabel,
}: { slices: DonutSlice[]; size?: number; centerLabel: string }) {
  const t = useTheme();
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = 22;

  if (total <= 0) {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center', height: size }}>
        <Text style={[type.caption, { color: t.inkMuted }]}>No spending yet</Text>
      </View>
    );
  }

  // 2px gap between segments, expressed as an angle at this radius.
  const gapAngle = (2 / r) * (180 / Math.PI);
  let angle = -90;
  const activeSlice = slices.find((s) => s.key === active);

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {slices.map((s) => {
          const sweep = (s.value / total) * 360;
          const start = angle;
          angle += sweep;
          const pad = Math.min(gapAngle, sweep * 0.25);
          const a0 = ((start + pad / 2) * Math.PI) / 180;
          const a1 = ((start + sweep - pad / 2) * Math.PI) / 180;
          const large = sweep - pad > 180 ? 1 : 0;
          const d = `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`;
          const isActive = active === s.key;
          return (
            <Path
              key={s.key}
              d={d}
              stroke={s.color}
              strokeWidth={isActive ? stroke + 6 : stroke}
              strokeLinecap="butt"
              fill="none"
              opacity={active && !isActive ? 0.35 : 1}
              onPress={() => setActive(isActive ? null : s.key)}
            />
          );
        })}
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: size,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={[type.tiny, { color: t.inkMuted }]}>
          {activeSlice ? activeSlice.label : centerLabel}
        </Text>
        <Text style={[type.title, { color: t.inkPrimary, fontVariant: ['tabular-nums'] }]}>
          {fmtShort(activeSlice ? activeSlice.value : total)}
        </Text>
        {activeSlice ? (
          <Text style={[type.tiny, { color: t.inkSecondary }]}>
            {Math.round((activeSlice.value / total) * 100)}% of spending
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Legend: colored mark carries identity, text stays in ink tokens. */
export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: it.color }} />
          <Text style={[type.tiny, { color: t.inkSecondary }]}>
            {it.label}
            {it.value ? ` · ${it.value}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface FlowBar {
  label: string;
  income: number;
  expense: number;
}

/** Paired income/expense bars per month with tap-to-inspect. */
export function CashFlowBars({
  data, width, height = 160, incomeColor, expenseColor,
}: { data: FlowBar[]; width: number; height: number; incomeColor: string; expenseColor: string }) {
  const t = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const plotH = height - 34;
  const groupW = width / data.length;
  const barW = Math.min(16, groupW / 3);

  return (
    <View>
      <View style={{ height: 18, marginBottom: 2, alignItems: 'center' }}>
        {active !== null && data[active] ? (
          <Text style={[type.tiny, { color: t.inkSecondary }]}>
            {data[active].label}: in {fmtShort(data[active].income)} · out {fmtShort(data[active].expense)}
          </Text>
        ) : null}
      </View>
      <Svg width={width} height={height - 20}>
        {[0.5, 1].map((f) => (
          <Line
            key={f} x1={0} x2={width}
            y1={plotH - plotH * f + 4} y2={plotH - plotH * f + 4}
            stroke={t.gridline} strokeWidth={1}
          />
        ))}
        <Line x1={0} x2={width} y1={plotH + 4} y2={plotH + 4} stroke={t.baseline} strokeWidth={1} />
        {data.map((d, i) => {
          const cx = i * groupW + groupW / 2;
          const hIn = (d.income / max) * plotH;
          const hOut = (d.expense / max) * plotH;
          const dim = active !== null && active !== i;
          return (
            <G key={d.label} opacity={dim ? 0.35 : 1}>
              <Rect
                x={cx - barW - 1} y={plotH + 4 - hIn} width={barW} height={Math.max(hIn, 2)}
                rx={4} fill={incomeColor}
                onPress={() => setActive(active === i ? null : i)}
              />
              <Rect
                x={cx + 1} y={plotH + 4 - hOut} width={barW} height={Math.max(hOut, 2)}
                rx={4} fill={expenseColor}
                onPress={() => setActive(active === i ? null : i)}
              />
            </G>
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row' }}>
        {data.map((d, i) => (
          <Pressable
            key={d.label}
            style={{ width: groupW, alignItems: 'center' }}
            onPress={() => setActive(active === i ? null : i)}
          >
            <Text style={[type.tiny, { color: t.inkMuted }]}>{d.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Net worth line: 2px line, >=8px markers on tap, hairline grid. */
export function TrendLine({
  points, width, height = 150, color, labels,
}: { points: number[]; width: number; height?: number; color: string; labels: string[] }) {
  const t = useTheme();
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const padY = 12;
  const plotH = height - 30;
  const stepX = width / (points.length - 1);
  const xy = points.map((p, i) => ({
    x: i * stepX,
    y: padY + (plotH - padY * 2) * (1 - (p - min) / span),
  }));
  const d = xy.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <View>
      <View style={{ height: 18, alignItems: 'center' }}>
        {active !== null ? (
          <Text style={[type.tiny, { color: t.inkSecondary }]}>
            {labels[active]}: {fmtShort(points[active])}
          </Text>
        ) : null}
      </View>
      <Svg width={width} height={plotH + 6}>
        {[0.25, 0.5, 0.75].map((f) => (
          <Line
            key={f} x1={0} x2={width} y1={plotH * f} y2={plotH * f}
            stroke={t.gridline} strokeWidth={1}
          />
        ))}
        <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
        {xy.map((p, i) => (
          <Circle
            key={i}
            cx={p.x} cy={p.y}
            r={active === i ? 5 : 4}
            fill={active === i ? color : 'transparent'}
            stroke={active === i ? t.surface : 'transparent'}
            strokeWidth={2}
            onPress={() => setActive(active === i ? null : i)}
          />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {labels.map((l, i) => (
          <Pressable key={`${l}-${i}`} onPress={() => setActive(active === i ? null : i)}>
            <Text style={[type.tiny, { color: active === i ? t.inkPrimary : t.inkMuted }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
