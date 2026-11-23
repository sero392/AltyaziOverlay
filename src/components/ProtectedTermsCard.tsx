import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Card, Field, Para, colors } from './ui';

/** Kelime alanının en fazla yüksekliği; fazlası panelin içinde kaydırılır. */
const LIST_MAX_HEIGHT = 280;

/** Liste ilk açıldığında ve "Devamını göster" ile her seferinde eklenen kelime sayısı. */
const PAGE_SIZE = 30;

interface Props {
  terms: string[];
  onAdd: (term: string) => void;
  onRemove: (term: string) => void;
  onReset: () => void;
}

/**
 * Çevrilmeyecek kelimeler (karakter / yer adları).
 *
 * Düzen: üstte her zaman görünen "ekle" satırı; altında açılır liste paneli. Panelin içinde
 * sırasıyla arama kutusu, sayaç, kelimeler ve en altta "Devamını göster" — böylece düğme
 * listeye ait görünür, giriş alanlarıyla karışmaz. Liste uzun olduğu için parça parça gösterilir.
 */
export function ProtectedTermsCard({ terms, onAdd, onRemove, onReset }: Props) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? terms.filter(t => t.toLowerCase().includes(q)) : terms),
    [terms, q],
  );
  const shown = matches.slice(0, visible);
  const remaining = matches.length - shown.length;
  const canAdd = draft.trim().length > 0;

  const submit = () => {
    if (!canAdd) {
      return;
    }
    onAdd(draft);
    setDraft('');
  };

  const search = (text: string) => {
    setQuery(text);
    setVisible(PAGE_SIZE); // yeni aramada baştan göster
  };

  return (
    <Card title="Çevrilmeyecek kelimeler">
      <Para>
        Karakter ve yer adları çeviride olduğu gibi kalır (ör. "Dutch"
        "Hollandaca" olmaz). Büyük/küçük harfe duyarlıdır.
      </Para>

      <View style={styles.addRow}>
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
          disabled={!canAdd}
          style={({ pressed }) => [
            styles.addButton,
            (!canAdd || pressed) && styles.dim,
          ]}
        >
          <Text style={styles.addButtonText}>Ekle</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Pressable
          onPress={() => setExpanded(e => !e)}
          style={styles.panelHeader}
          hitSlop={6}
        >
          <Text style={styles.panelTitle}>
            Kelime listesi <Text style={styles.badge}> {terms.length} </Text>
          </Text>
          <Text style={styles.toggle}>{expanded ? 'Gizle ▴' : 'Göster ▾'}</Text>
        </Pressable>

        {expanded ? (
          <View style={styles.panelBody}>
            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput
                value={query}
                onChangeText={search}
                placeholder="Listede ara…"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.searchInput}
              />
              {query ? (
                <Pressable onPress={() => search('')} hitSlop={10}>
                  <Text style={styles.clear}>✕</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.meta}>
                {q ? `${matches.length} sonuç` : 'Silmek için kelimeye dokun'}
              </Text>
              <Text style={styles.meta}>
                {shown.length} / {matches.length}
              </Text>
            </View>

            {q && matches.length === 0 ? (
              <Text style={styles.empty}>
                "{query.trim()}" listede yok. Yukarıdan ekleyebilirsin.
              </Text>
            ) : (
              <ScrollView
                style={styles.listScroll}
                contentContainerStyle={styles.chips}
                nestedScrollEnabled // sayfanın kendi ScrollView'ı içinde (Android)
                keyboardShouldPersistTaps="handled"
                persistentScrollbar
              >
                {shown.map(t => (
                  <Pressable
                    key={t}
                    onPress={() => onRemove(t)}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text style={styles.chipText}>{t}</Text>
                    <Text style={styles.chipX}>✕</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {remaining > 0 ? (
              <Pressable
                onPress={() => setVisible(v => v + PAGE_SIZE)}
                style={({ pressed }) => [
                  styles.moreButton,
                  pressed && styles.dim,
                ]}
              >
                <Text style={styles.moreText}>
                  Devamını göster · {remaining} kaldı
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <Pressable onPress={onReset} style={styles.resetRow} hitSlop={6}>
        <Text style={styles.link}>Varsayılan RDR2 listesine dön</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { opacity: 0.5 },

  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  addButtonText: { color: colors.text, fontWeight: '600' },

  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  panelTitle: { color: colors.text, fontWeight: '600' },
  badge: {
    color: colors.muted,
    fontWeight: '400',
    fontSize: 13,
  },
  toggle: { color: '#60a5fa', fontWeight: '600' },
  panelBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 12,
    gap: 10,
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchIcon: { color: colors.faint, fontSize: 18 },
  searchInput: {
    flex: 1,
    color: colors.text,
    paddingVertical: 9,
    fontSize: 15,
  },
  clear: { color: colors.muted, fontSize: 14, paddingHorizontal: 2 },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.faint, fontSize: 12 },
  empty: { color: colors.muted, paddingVertical: 8, textAlign: 'center' },

  listScroll: { maxHeight: LIST_MAX_HEIGHT, flexGrow: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingRight: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  chipPressed: { backgroundColor: colors.danger },
  chipText: { color: colors.text, fontSize: 14 },
  chipX: { color: colors.muted, fontSize: 11 },

  moreButton: {
    marginTop: 2,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  moreText: { color: colors.text, fontWeight: '600' },

  resetRow: { alignSelf: 'flex-start' },
  link: { color: '#60a5fa', fontSize: 13 },
});
