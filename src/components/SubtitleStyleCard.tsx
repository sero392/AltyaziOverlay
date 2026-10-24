import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SubtitleStyle } from '../native/SubtitleCapture';
import { Card, colors } from './ui';

const MIN_SIZE = 16;
const MAX_SIZE = 60;
const SIZE_STEP = 2;

const TEXT_COLORS = ['#FFFFFF', '#FDE047', '#4ADE80', '#67E8F9', '#F9A8D4'];
const BG_COLORS = ['#000000', '#1E293B', '#1E3A8A', '#3F3F46'];
const BG_OPACITIES = [0, 25, 50, 75, 100];

interface Props {
  style: SubtitleStyle;
  onChange: (patch: Partial<SubtitleStyle>) => void;
  onReset: () => void;
}

/** Altyazının yazı boyutu, yazı rengi ve arka planı. TV'ye ve telefondaki pencereye uygulanır. */
export function SubtitleStyleCard({ style, onChange, onReset }: Props) {
  const changeSize = (delta: number) =>
    onChange({
      fontSize: Math.min(
        MAX_SIZE,
        Math.max(MIN_SIZE, style.fontSize + delta),
      ),
    });

  return (
    <Card title="Altyazı görünümü">
      <View style={styles.preview}>
        <Text
          style={[
            styles.previewText,
            {
              color: style.textColor,
              // Telefon penceresiyle aynı ölçek (TV boyutunun 2/3'ü).
              fontSize: (style.fontSize * 2) / 3,
              backgroundColor: withOpacity(style.bgColor, style.bgOpacity),
            },
          ]}
        >
          Dikkat et, arkanda biri var!
        </Text>
      </View>

      <Text style={styles.label}>Yazı boyutu</Text>
      <View style={styles.row}>
        <StepButton
          label="−"
          disabled={style.fontSize <= MIN_SIZE}
          onPress={() => changeSize(-SIZE_STEP)}
        />
        <Text style={styles.sizeValue}>{style.fontSize}</Text>
        <StepButton
          label="+"
          disabled={style.fontSize >= MAX_SIZE}
          onPress={() => changeSize(SIZE_STEP)}
        />
      </View>

      <Text style={styles.label}>Yazı rengi</Text>
      <Swatches
        options={TEXT_COLORS}
        value={style.textColor}
        onChange={textColor => onChange({ textColor })}
      />

      <Text style={styles.label}>Arka plan rengi</Text>
      <Swatches
        options={BG_COLORS}
        value={style.bgColor}
        onChange={bgColor => onChange({ bgColor })}
      />

      <Text style={styles.label}>Arka plan opaklığı</Text>
      <View style={styles.row}>
        {BG_OPACITIES.map(v => (
          <Pressable
            key={v}
            onPress={() => onChange({ bgOpacity: v })}
            style={[styles.chip, style.bgOpacity === v && styles.chipActive]}
          >
            <Text style={styles.chipText}>{v === 0 ? 'Yok' : `%${v}`}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={onReset} style={styles.reset}>
        <Text style={styles.link}>Varsayılana dön</Text>
      </Pressable>
    </Card>
  );
}

function Swatches({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map(c => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          style={[
            styles.swatch,
            { backgroundColor: c },
            value.toUpperCase() === c && styles.swatchActive,
          ]}
        />
      ))}
    </View>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.step, disabled && styles.disabled]}
    >
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

/** "#RRGGBB" + 0-100 opaklık -> rgba() */
function withOpacity(hex: string, opacity: number): string {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

const styles = StyleSheet.create({
  preview: {
    backgroundColor: '#475569',
    borderRadius: 10,
    paddingVertical: 20,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  previewText: {
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    overflow: 'hidden',
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
  label: { color: colors.muted, fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sizeValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'center',
  },
  step: {
    width: 40,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.text, fontSize: 20, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
  },
  swatchActive: { borderColor: colors.primary, borderWidth: 3 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  reset: { alignSelf: 'flex-start', marginTop: 4 },
  link: { color: '#60a5fa' },
});
