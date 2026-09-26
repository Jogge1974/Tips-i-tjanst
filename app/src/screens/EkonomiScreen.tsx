import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, EkonomiData, StatistikData } from '../services/api';

type Segment = 'ekonomi' | 'statistik';

const GREEN = '#1B5E20';
const RED = '#C62828';

export default function EkonomiScreen() {
  const [segment, setSegment] = useState<Segment>('ekonomi');
  const [ekonomi, setEkonomi] = useState<EkonomiData | null>(null);
  const [statistik, setStatistik] = useState<StatistikData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [eko, stat] = await Promise.all([api.getEkonomi(), api.getStatistik()]);
      setEkonomi(eko);
      setStatistik(stat);
    } catch (e) {
      console.error('Ekonomi fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.segmentBar}>
        {(['ekonomi', 'statistik'] as Segment[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.segmentButton, segment === s && styles.segmentButtonActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'ekonomi' ? 'Ekonomi' : 'Statistik'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[GREEN]} />}
      >
        {segment === 'ekonomi' && <EkonomiView data={ekonomi} />}
        {segment === 'statistik' && <StatistikView data={statistik} />}
      </ScrollView>
    </View>
  );
}

function EkonomiView({ data }: { data: EkonomiData | null }) {
  if (!data) return <Text style={styles.empty}>Ingen ekonomidata</Text>;

  return (
    <>
      <View style={styles.bankCard}>
        <Text style={styles.bankLabel}>Banken</Text>
        <Text style={styles.bankValue}>{data.bank.toLocaleString('sv-SE')} kr</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Omgångar</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 1.4 }]}>Omgång</Text>
          <Text style={[styles.th, { flex: 1.4 }]}>Ins (S/X)</Text>
          <Text style={[styles.th, { flex: 1.4 }]}>Vin (S/X)</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Total</Text>
        </View>
        {data.omgangar.map((o) => (
          <View key={o.spelomgang} style={styles.tableRow}>
            <View style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.td}>{o.spelomgang}</Text>
              {o.isSlutspel === 1 && <Text style={styles.slutspelBadge}>S</Text>}
            </View>
            <Text style={[styles.td, { flex: 1.4, color: RED }]}>{o.insats} / {o.extraInsats}</Text>
            <Text style={[styles.td, { flex: 1.4, color: GREEN }]}>{o.vinst} / {o.extraVinst}</Text>
            <Text style={[styles.td, { flex: 1, textAlign: 'right', fontWeight: '700', color: o.tot >= 0 ? GREEN : RED }]}>
              {o.tot}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Skuldläge</Text>
        {data.skuldlage.map((s, i) => (
          <View key={i} style={styles.simpleRow}>
            <Text style={styles.simpleLabel}>{s.efternamn}</Text>
            <Text style={[styles.simpleValue, { color: s.diff < 0 ? RED : GREEN }]}>{s.diff} kr</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Utdelning</Text>
        {data.utdelning.length === 0 ? (
          <Text style={styles.empty}>Ingen utdelning har gjorts</Text>
        ) : (
          data.utdelning.map((u, i) => (
            <View key={i} style={styles.simpleRow}>
              <Text style={styles.simpleLabel}>{u.spelomgang}</Text>
              <Text style={styles.simpleValue}>{u.utdelning} kr</Text>
            </View>
          ))
        )}
      </View>
    </>
  );
}

function StatistikView({ data }: { data: StatistikData | null }) {
  if (!data) return <Text style={styles.empty}>Ingen statistik</Text>;

  const round = (n: number) => Math.round(Number(n) || 0);

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Säsongsstatistik</Text>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 1.2 }]}>Säsong</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Kr/v</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Bäst</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Sämst</Text>
          <Text style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>Totalt</Text>
        </View>
        {data.sasong.map((s) => (
          <View key={s.sasong} style={styles.tableRow}>
            <Text style={[styles.td, { flex: 1.2 }]}>Säs {s.sasong}</Text>
            <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>{round(s.snittPerMedl)}</Text>
            <Text style={[styles.td, { flex: 1, textAlign: 'right', color: GREEN }]}>{round(s.maxVinst)}</Text>
            <Text style={[styles.td, { flex: 1, textAlign: 'right', color: RED }]}>{round(s.minVinst)}</Text>
            <Text style={[styles.td, { flex: 1.1, textAlign: 'right', fontWeight: '700', color: round(s.total) >= 0 ? GREEN : RED }]}>
              {round(s.total)}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  empty: { color: '#888', fontStyle: 'italic', paddingVertical: 8 },

  segmentBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 6,
    margin: 12,
    marginBottom: 0,
    borderRadius: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  segmentButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentButtonActive: { backgroundColor: GREEN },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#666' },
  segmentTextActive: { color: '#fff' },

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

  bankCard: {
    backgroundColor: GREEN,
    borderRadius: 12,
    padding: 20,
    marginBottom: 14,
    alignItems: 'center',
  },
  bankLabel: { color: '#C8E6C9', fontSize: 14, fontWeight: '600' },
  bankValue: { color: '#fff', fontSize: 32, fontWeight: '800', marginTop: 4 },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 6,
    marginBottom: 4,
  },
  th: { fontSize: 11, fontWeight: '700', color: '#999' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  td: { fontSize: 13, color: '#333' },
  slutspelBadge: {
    marginLeft: 4,
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#2E7D32',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },

  simpleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  simpleLabel: { fontSize: 14, color: '#333', flex: 1 },
  simpleValue: { fontSize: 14, fontWeight: '600' },
  countBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: GREEN,
    minWidth: 26,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
});
