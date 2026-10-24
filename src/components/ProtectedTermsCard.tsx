import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Field, Para, colors } from './ui';

interface Props {
  terms: string[];
  onAdd: (term: string) => void;
  onRemove: (term: string) => void;
  onReset: () => void;
}

/** Çevrilmeyecek kelimeler (karakter / yer adları): ekle, dokunarak sil, varsayılana dön. */
export function ProtectedTermsCard({ terms, onAdd, onRemove, onReset }: Props) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);

  const submit = () => {
    onAdd(draft);
    setDraft('');
  };

  return (
    <Card title="Çevrilmeyecek kelimeler">
      <Para>
        Karakter ve yer adları çeviride olduğu gibi kalır (ör. "Dutch"
        "Hollandaca" olmaz). Büyük/küçük harfe duyarlıdır. Silmek için
        kelimeye dokun.
      </Para>

      <Pressable onPress={() => setExpanded(e => !e)}>
        <Text style={styles.link}>
          {expanded ? 'Listeyi gizle' : `Listeyi göster (${terms.length})`}
        </Text>
      </Pressable>

      {expanded ? (
        <>
          <View style={styles.chips}>
            {terms.map(t => (
              <Pressable
                key={t}
                onPress={() => onRemove(t)}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{t} ×</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.row}>
            <Field
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submit}
              placeholder="Yeni kelime (ör. Micah)"
              autoCapitalize="words"
              returnKeyType="done"
              style={styles.flex}
            />
            <Pressable
              onPress={submit}
              disabled={!draft.trim()}
              style={[styles.addButton, !draft.trim() && styles.disabled]}
            >
              <Text style={styles.chipText}>Ekle</Text>
            </Pressable>
          </View>

          <Pressable onPress={onReset}>
            <Text style={styles.link}>Varsayılan RDR2 listesine dön</Text>
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  chipText: { color: colors.text },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  disabled: { opacity: 0.5 },
  link: { color: '#60a5fa' },
});
