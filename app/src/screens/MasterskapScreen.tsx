import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, StatistikData } from '../services/api';

const GREEN = '#1B5E20';

export default function MasterskapScreen() {
  const [data, setData] = useState<StatistikData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setData(await api.getStatistik());
    } catch (e) {
      console.error('Mästerskap fetch error:', e);
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[GREEN]} />}
    >
      <RankCard title="Champions" rows={data?.champions || []} />
      <RankCard title="Charity Shield" rows={data?.charityShield || []} />
      <RankCard title="TipsAllsvenskan" rows={data?.tipsAllsvenskan || []} />
      <RankCard title="Cupvinnare" rows={data?.cupmastare || []} />
    </ScrollView>
  );
}

function RankCard({ title, rows }: { title: string; rows: { namn: string; antal: number }[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>Ingen data</Text>
      ) : (
        rows.map((r, i) => (
          <View key={i} style={styles.simpleRow}>
            <Text style={styles.simpleLabel}>{r.namn}</Text>
            <Text style={styles.countBadge}>{r.antal}</Text>
          </View>
        ))
      )}
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
  simpleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  simpleLabel: { fontSize: 14, color: '#333', flex: 1 },
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
