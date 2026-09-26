import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, CupData, CupMatch } from '../services/api';
import { useAuth } from '../context/AuthContext';

const GREEN = '#1B5E20';
const RED = '#C62828';
const ORANGE = '#EF6C00';

const PHASES: { fas: number; title: string }[] = [
  { fas: 4, title: 'Kvartsfinaler' },
  { fas: 2, title: 'Semifinaler' },
  { fas: 1, title: 'Final' },
];

export default function CupAdminScreen() {
  const { user } = useAuth();
  const userId = user ? Number(user.id) : 0;
  const [cup, setCup] = useState<CupData | null>(null);
  const [poang, setPoang] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const applyCup = (data: CupData) => {
    setCup(data);
    const map: Record<string, string> = {};
    data.bracket.forEach((b) => {
      map[`${b.cupfas}:${b.id}`] = String(b.poang ?? 0);
    });
    setPoang(map);
  };

  const load = useCallback(async () => {
    try {
      applyCup(await api.getCup());
    } catch (e) {
      console.error('CupAdmin load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const confirmAction = (title: string, message: string, onConfirm: () => void) => {
    Alert.alert(title, message, [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Kör', style: 'destructive', onPress: onConfirm },
    ]);
  };

  const doInit = () =>
    confirmAction(
      'Initiera cup',
      'Detta raderar aktuell säsongs cupträd och seedar 8 kvartsfinalister från föregående säsongs TipsAllsvenskan. Fortsätta?',
      async () => {
        try {
          const data = await api.cupInit(userId);
          if ((data as any).error) return Alert.alert('Fel', (data as any).error);
          applyCup(data);
          Alert.alert('Klart', 'Cupen är initierad.');
        } catch (e: any) {
          Alert.alert('Fel', e.message);
        }
      }
    );

  const doAdvance = () =>
    confirmAction(
      'Avancera fas',
      'Vinnarna (högst poäng per match) förs vidare till nästa fas. Fortsätta?',
      async () => {
        try {
          const data = await api.cupAdvance(userId);
          if ((data as any).error) return Alert.alert('Fel', (data as any).error);
          applyCup(data);
          Alert.alert('Klart', 'Cupen är avancerad.');
        } catch (e: any) {
          Alert.alert('Fel', e.message);
        }
      }
    );

  const savePoang = async () => {
    if (!cup) return;
    setSaving(true);
    try {
      const payload = cup.bracket.map((b) => ({
        id: b.id,
        cupfas: b.cupfas,
        poang: Number(poang[`${b.cupfas}:${b.id}`]) || 0,
      }));
      const data = await api.cupSavePoang(userId, payload);
      if ((data as any).error) return Alert.alert('Fel', (data as any).error);
      applyCup(data);
      Alert.alert('Sparat', 'Poängen är sparade.');
    } catch (e: any) {
      Alert.alert('Fel', e.message);
    } finally {
      setSaving(false);
    }
  };

  const setMark = async (kind: 'aktiv' | 'nasta', m: CupMatch, on: boolean) => {
    try {
      const cupfas = on ? m.cupfas : null;
      const matchIndex = on ? m.matchIndex : null;
      const data =
        kind === 'aktiv'
          ? await api.cupSetAktiv(userId, cupfas, matchIndex)
          : await api.cupSetNasta(userId, cupfas, matchIndex);
      if ((data as any).error) return Alert.alert('Fel', (data as any).error);
      applyCup(data);
    } catch (e: any) {
      Alert.alert('Fel', e.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  const hasCup = (cup?.matches.length || 0) > 0;
  const byFas = (fas: number) => (cup?.matches || []).filter((m) => m.cupfas === fas);
  const winner = cup?.winner || null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[GREEN]} />}
    >
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Åtgärder{cup?.sasong != null ? ` – säsong ${cup.sasong}` : ''}</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtn, styles.actionInit]} onPress={doInit}>
            <Text style={styles.actionBtnText}>Initiera cup</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.actionAdvance]} onPress={doAdvance}>
            <Text style={styles.actionBtnText}>Avancera fas</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!hasCup ? (
        <View style={styles.card}>
          <Text style={styles.empty}>Ingen cup för säsongen. Tryck "Initiera cup" för att starta.</Text>
        </View>
      ) : (
        <>
          {winner && (
            <View style={styles.winnerCard}>
              <Text style={styles.winnerLabel}>🏆 Cupmästare</Text>
              <Text style={styles.winnerName}>{winner.namn}</Text>
            </View>
          )}

          {PHASES.map(({ fas, title }) => {
            const matches = byFas(fas);
            if (matches.length === 0) return null;
            return (
              <View key={fas} style={styles.card}>
                <Text style={styles.cardTitle}>{title}</Text>
                {matches.map((m) => (
                  <MatchEditor
                    key={`${m.cupfas}:${m.matchIndex}`}
                    match={m}
                    poang={poang}
                    setPoang={setPoang}
                    onMark={setMark}
                  />
                ))}
              </View>
            );
          })}

          <TouchableOpacity style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={savePoang} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Sparar…' : 'Spara poäng'}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function MatchEditor({
  match,
  poang,
  setPoang,
  onMark,
}: {
  match: CupMatch;
  poang: Record<string, string>;
  setPoang: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onMark: (kind: 'aktiv' | 'nasta', m: CupMatch, on: boolean) => void;
}) {
  const boxStyle = [
    styles.matchBox,
    match.aktiv && styles.matchBoxActive,
    !match.aktiv && match.nasta && styles.matchBoxNasta,
  ];

  return (
    <View style={boxStyle}>
      <Text style={styles.matchTitle}>{match.title}</Text>
      {[0, 1].map((idx) => {
        const p = match.players[idx];
        if (p) {
          const key = `${match.cupfas}:${p.id}`;
          return (
            <View key={idx} style={styles.playerRow}>
              <Text style={styles.playerName} numberOfLines={1}>{p.namn}</Text>
              <TextInput
                style={styles.poangInput}
                keyboardType="numeric"
                value={poang[key] ?? ''}
                onChangeText={(txt) => setPoang((prev) => ({ ...prev, [key]: txt.replace(/[^0-9.-]/g, '') }))}
              />
            </View>
          );
        }
        return (
          <View key={idx} style={styles.playerRow}>
            <Text style={styles.playerPlaceholder} numberOfLines={1}>{match.placeholders[idx] || '?'}</Text>
            <Text style={styles.poangDisabled}>–</Text>
          </View>
        );
      })}

      <View style={styles.markRow}>
        <TouchableOpacity
          style={[styles.markBtn, match.aktiv && styles.markBtnActive]}
          onPress={() => onMark('aktiv', match, !match.aktiv)}
        >
          <Text style={[styles.markBtnText, match.aktiv && styles.markBtnTextActive]}>
            {match.aktiv ? '🔴 Veckans match' : 'Veckans match'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.markBtn, match.nasta && styles.markBtnNasta]}
          onPress={() => onMark('nasta', match, !match.nasta)}
        >
          <Text style={[styles.markBtnText, match.nasta && styles.markBtnTextNasta]}>
            {match.nasta ? '🟠 Nästa match' : 'Nästa match'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5' },
  content: { padding: 16, paddingBottom: 40 },
  empty: { color: '#888', fontStyle: 'italic', paddingVertical: 8 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: GREEN, marginBottom: 12 },

  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  actionInit: { backgroundColor: '#1565C0' },
  actionAdvance: { backgroundColor: GREEN },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  winnerCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    padding: 18,
    marginBottom: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFD54F',
  },
  winnerLabel: { fontSize: 14, fontWeight: '600', color: '#F57F17' },
  winnerName: { fontSize: 22, fontWeight: '800', color: '#333', marginTop: 4 },

  matchBox: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    marginBottom: 12,
    padding: 10,
  },
  matchBoxActive: { borderColor: RED, borderWidth: 2 },
  matchBoxNasta: { borderColor: ORANGE, borderWidth: 2 },
  matchTitle: { fontSize: 12, fontWeight: '700', color: '#999', marginBottom: 6 },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  playerName: { fontSize: 15, color: '#333', flex: 1, marginRight: 10 },
  playerPlaceholder: { fontSize: 14, color: '#aaa', fontStyle: 'italic', flex: 1, marginRight: 10 },
  poangInput: {
    width: 70,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    textAlign: 'center',
    fontSize: 15,
    color: '#333',
    backgroundColor: '#fafafa',
  },
  poangDisabled: { width: 70, textAlign: 'center', fontSize: 15, color: '#ccc' },

  markRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  markBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  markBtnActive: { backgroundColor: '#FFEBEE' },
  markBtnNasta: { backgroundColor: '#FFF3E0' },
  markBtnText: { fontSize: 12, fontWeight: '600', color: '#666' },
  markBtnTextActive: { color: RED },
  markBtnTextNasta: { color: ORANGE },

  saveBtn: {
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
