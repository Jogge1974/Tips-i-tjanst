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
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface StandingEntry {
  position: number;
  id: number;
  namn: string;
  spelade: number;
  sakra: number;
  poang: number;
}

export default function TipsAllsvenskanScreen() {
  const { user } = useAuth();
  const [standings, setStandings] = useState<StandingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sasong, setSasong] = useState<number | null>(null);
  const userId = user ? Number(user.id) : null;

  const fetchData = useCallback(async () => {
    try {
      const data = await api.getTipsAllsvenskan(user?.id);
      setStandings(data.standings || []);
      setSasong(data.sasong);
    } catch (e) {
      console.error('TipsAllsvenskan fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

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
        <ActivityIndicator size="large" color="#1B5E20" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.headerIcon}>🏆</Text>
        <Text style={styles.title}>TipsAllsvenskan</Text>
        {sasong && <Text style={styles.subtitle}>Säsong {sasong}</Text>}
      </View>

      {/* Top 3 podium - only after all 12 rounds */}
      {standings.length >= 3 && standings[0].spelade >= 12 && (
        <View style={styles.podium}>
          {[1, 0, 2].map((idx) => {
            const entry = standings[idx];
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
            const isMe = Number(entry.id) === userId;
            return (
              <View key={entry.id} style={[styles.podiumItem, idx === 0 && styles.podiumFirst]}>
                <Text style={styles.podiumMedal}>{medal}</Text>
                <Text style={[styles.podiumName, isMe && styles.podiumNameMe]} numberOfLines={1}>
                  {entry.namn.split(' ')[0]}
                </Text>
                <Text style={styles.podiumPoints}>{entry.poang.toFixed(1)}p</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* My position card - only after all 12 rounds */}
      {(() => {
        const me = standings.find(e => Number(e.id) === userId);
        if (!me || me.spelade < 12) return null;
        return (
          <View style={styles.myCard}>
            <View style={styles.myCardLeft}>
              <Text style={styles.myCardPos}>{me.position}</Text>
            </View>
            <View style={styles.myCardCenter}>
              <Text style={styles.myCardName}>{me.namn}</Text>
              <Text style={styles.myCardSub}>{me.spelade} spelade · {me.sakra} vinster</Text>
            </View>
            <View style={styles.myCardRight}>
              <Text style={styles.myCardPoints}>{me.poang.toFixed(1)}</Text>
              <Text style={styles.myCardPtsLabel}>poäng</Text>
            </View>
          </View>
        );
      })()}

      <View style={styles.table}>
        {/* Header */}
        <View style={[styles.row, styles.headerRow]}>
          <Text style={[styles.cell, styles.posCol, styles.headerText]}>#</Text>
          <Text style={[styles.cell, styles.nameCol, styles.headerText]}>Namn</Text>
          <Text style={[styles.cell, styles.numCol, styles.headerText]}>Sp</Text>
          <Text style={[styles.cell, styles.numCol, styles.headerText]}>V</Text>
          <Text style={[styles.cell, styles.ptsCol, styles.headerText]}>Poäng</Text>
        </View>

        {standings.map((entry, idx) => {
          const isMe = Number(entry.id) === userId;
          const isPlayoff = entry.position <= 8;
          const isEven = idx % 2 === 0;
          return (
            <View
              key={entry.id}
              style={[
                styles.row,
                isEven && !isMe && styles.evenRow,
                isPlayoff && !isMe && styles.playoffRow,
                isMe && styles.myRowInTable,
                entry.position === 8 && styles.cutoffRow,
              ]}
            >
              <Text style={[styles.cell, styles.posCol, isMe && styles.myTextInTable]}>
                {entry.position}
              </Text>
              <Text style={[styles.cell, styles.nameCol, isMe && styles.myTextInTable]} numberOfLines={1}>
                {entry.namn}
              </Text>
              <Text style={[styles.cell, styles.numCol, isMe && styles.myTextInTable]}>{entry.spelade}</Text>
              <Text style={[styles.cell, styles.numCol, isMe && styles.myTextInTable]}>{entry.sakra}</Text>
              <Text style={[styles.cell, styles.ptsCol, isMe && styles.myTextInTable]}>
                {entry.poang.toFixed(1)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#F1F8E9', borderColor: '#66BB6A' }]} />
          <Text style={styles.legendText}>Slutspelsplats (topp 8)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#1B5E20', borderColor: '#1B5E20' }]} />
          <Text style={styles.legendText}>Din placering</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 8,
  },
  headerIcon: {
    fontSize: 44,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1B5E20',
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  podium: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginBottom: 20,
    gap: 12,
  },
  podiumItem: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    minWidth: 80,
  },
  podiumFirst: {
    paddingVertical: 16,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  podiumMedal: {
    fontSize: 28,
    marginBottom: 4,
  },
  podiumName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
  },
  podiumNameMe: {
    color: '#1B5E20',
  },
  podiumPoints: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  table: {
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    marginHorizontal: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8e8e8',
  },
  evenRow: {
    backgroundColor: '#FAFAFA',
  },
  headerRow: {
    backgroundColor: '#1B5E20',
    paddingVertical: 14,
    borderBottomWidth: 0,
  },
  playoffRow: {
    backgroundColor: '#F1F8E9',
  },
  myRow: {
    backgroundColor: '#66BB6A',
    paddingVertical: 16,
    marginHorizontal: -2,
    borderRadius: 10,
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
    borderBottomWidth: 0,
  },
  myRowInTable: {
    backgroundColor: '#C8E6C9',
    borderLeftWidth: 3,
    borderLeftColor: '#1B5E20',
  },
  myTextInTable: {
    color: '#1B5E20',
    fontWeight: '700',
  },
  myCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1B5E20',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  myCardLeft: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  myCardPos: {
    fontSize: 18,
    fontWeight: '900',
    color: '#1B5E20',
  },
  myCardCenter: {
    flex: 1,
    marginLeft: 14,
  },
  myCardName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  myCardSub: {
    fontSize: 12,
    color: '#A5D6A7',
    marginTop: 2,
  },
  myCardRight: {
    alignItems: 'flex-end',
  },
  myCardPoints: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
  },
  myCardPtsLabel: {
    fontSize: 10,
    color: '#A5D6A7',
    textTransform: 'uppercase',
  },
  cutoffRow: {
    borderBottomWidth: 2.5,
    borderBottomColor: '#2E7D32',
  },
  headerText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cell: {
    fontSize: 13,
    color: '#444',
  },

  posCol: {
    width: 30,
    textAlign: 'center',
    fontWeight: '700',
    color: '#999',
    fontSize: 13,
  },
  nameCol: {
    flex: 1,
    paddingRight: 8,
    fontWeight: '500',
  },
  numCol: {
    width: 32,
    textAlign: 'center',
    color: '#777',
  },
  ptsCol: {
    width: 50,
    textAlign: 'right',
    fontWeight: '700',
    fontSize: 14,
    color: '#333',
  },
  legend: {
    marginTop: 16,
    marginBottom: 30,
    paddingHorizontal: 4,
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 8,
    borderWidth: 1.5,
    borderColor: '#ccc',
  },
  legendText: {
    fontSize: 12,
    color: '#666',
  },
});
