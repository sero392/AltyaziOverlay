import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

/** Yönetim paneli ve kurulum sihirbazı için ortak, sade yapı taşları. */
export const colors = {
  bg: '#0b0f17',
  card: '#131a26',
  border: '#1e293b',
  text: '#ffffff',
  muted: '#94a3b8',
  faint: '#64748b',
  primary: '#2563eb',
  danger: '#7f1d1d',
  ok: '#4ade80',
  warn: '#fbbf24',
  error: '#f87171',
};

export function Card({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        (disabled || pressed) && styles.dim,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      autoCorrect={false}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function Para({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'text' | 'ok' | 'warn' | 'error';
}) {
  return <Text style={[styles.para, styles[tone]]}>{children}</Text>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

/** Sekme sayfası başlığı: büyük başlık ve isteğe bağlı kısa açıklama. */
export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View>
      <Text style={styles.pageTitle}>{title}</Text>
      {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/** Kaydırılabilir sekme sayfası. */
export function Page({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <PageHeader title={title} subtitle={subtitle} />
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginTop: 12,
  },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  button: {
    flexGrow: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonDanger: { backgroundColor: colors.danger },
  buttonGhost: { backgroundColor: colors.border },
  buttonText: { color: colors.text, fontWeight: '600' },
  dim: { opacity: 0.5 },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  para: { lineHeight: 20 },
  muted: { color: colors.muted },
  text: { color: colors.text },
  ok: { color: colors.ok },
  warn: { color: colors.warn },
  error: { color: colors.error },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  pageTitle: { color: colors.text, fontSize: 24, fontWeight: '700' },
  pageSubtitle: { color: colors.muted, marginTop: 4 },
});
