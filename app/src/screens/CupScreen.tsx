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
import { api, CupData, CupMatch } from '../services/api';

const GREEN = '#1B5E20';
const RED = '#C62828';
const ORANGE = '#EF6C00';

export default function CupScreen() {
  const [cup, setCup] = useState<CupData | null>(null);
  const [sasong, setSasong] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (selected?: number) => {
    try {
      const cupData = await api.getCup(selected);
      setCup(cupData);
    } catch (e) {
      console.error('Cup fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData(sasong);
    }, [fetchData, sasong])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchData(sasong);
  };

  const changeSasong = async (s: number) => {
    setSasong(s);
    try {
      const cupData = await api.getCup(s);
      setCup(cupData);
    } catch (e) {
      console.error('Cup fetch error:', e);
    }
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
      <CupView data={cup} onSelectSasong={changeSasong} selected={sasong} />
    </ScrollView>
  );
}

function CupView({
  data,
  onSelectSasong,
  selected,
}: {
  data: CupData | null;
  onSelectSasong: (s: number) => void;
  selected?: number;
}) {
  if (!data) return <Text style={styles.empty}>Ingen cupdata</Text>;

  const active = selected ?? data.sasong ?? undefined;
  // Dölj matcher utan personer, men behåll de som är markerade som veckans/nästa match
  const visible = (m: CupMatch) => !!m.players[0] || !!m.players[1] || m.aktiv || m.nasta;
  const kvart = data.matches.filter((m) => m.cupfas === 4 && visible(m));
  const semi = data.matches.filter((m) => m.cupfas === 2 && visible(m));
  const final = data.matches.filter((m) => m.cupfas === 1 && visible(m));
  const winner = data.winner;
  const hasCup = data.matches.length > 0;

  const aktivMatch = data.matches.find((m) => m.aktiv) || null;

  return (
    <>
      {data.seasons.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonBar}>
          {data.seasons.map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.seasonChip, active === s && styles.seasonChipActive]}
              onPress={() => onSelectSasong(s)}
            >
              <Text style={[styles.seasonChipText, active === s && styles.seasonChipTextActive]}>
                Säs {s}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {aktivMatch && (
        <View style={[styles.matchBanner, { backgroundColor: '#FFEBEE', borderColor: '#EF9A9A' }]}>
          <Text style={[styles.matchBannerLabel, { color: RED }]}>🔴 Veckans cupmatch</Text>
          <Text style={styles.matchBannerTitle}>{aktivMatch.title}</Text>
          <Text style={styles.matchBannerNames}>{matchNames(aktivMatch)}</Text>
        </View>
      )}

      {!hasCup ? (
        <View style={styles.card}>
          <Text style={styles.empty}>Ingen cup denna säsong</Text>
        </View>
      ) : (
        <>
          {winner && (
            <View style={styles.winnerCard}>
              <Text style={styles.winnerLabel}>🏆 Cupmästare</Text>
              <Text style={styles.winnerName}>{winner.namn}</Text>
            </View>
          )}
          <CupPhase title="Final" matches={final} />
          <CupPhase title="Semifinaler" matches={semi} />
          <CupPhase title="Kvartsfinaler" matches={kvart} />
        </>
      )}
    </>
  );
}

function matchNames(m: CupMatch): string {
  const label = (i: number) => (m.players[i] ? m.players[i]!.namn : m.placeholders[i] || '?');
  return `${label(0)} – ${label(1)}`;
}

function CupPhase({ title, matches }: { title: string; matches: CupMatch[] }) {
  if (matches.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {matches.map((m) => (
        <CupMatchBox key={`${m.cupfas}:${m.matchIndex}`} match={m} />
      ))}
    </View>
  );
}

function CupMatchBox({ match }: { match: CupMatch }) {
  const a = match.players[0];
  const b = match.players[1];
  const bothPlayed = !!a && !!b;
  const aWins = bothPlayed && a!.poang > b!.poang;
  const bWins = bothPlayed && b!.poang > a!.poang;

  const boxStyle = [
    styles.matchBox,
    match.aktiv && styles.matchBoxActive,
    !match.aktiv && match.nasta && styles.matchBoxNasta,
  ];

  return (
    <View style={boxStyle}>
      {(match.aktiv || match.nasta) && (
        <Text style={[styles.matchTag, match.aktiv ? styles.matchTagActive : styles.matchTagNasta]}>
          {match.aktiv ? 'Veckans match' : 'Nästa match'}
        </Text>
      )}
      <PlayerRow
        namn={a ? a.namn : match.placeholders[0] || '?'}
        poang={a ? a.poang : null}
        winner={aWins}
        placeholder={!a}
      />
      <PlayerRow
        namn={b ? b.namn : match.placeholders[1] || '?'}
        poang={b ? b.poang : null}
        winner={bWins}
        placeholder={!b}
      />
    </View>
  );
}

function PlayerRow({
  namn,
  poang,
  winner,
  placeholder,
}: {
  namn: string;
  poang: number | null;
  winner: boolean;
  placeholder: boolean;
}) {
  return (
    <View style={[styles.playerRow, winner && styles.playerRowWinner]}>
      <Text
        style={[styles.playerName, winner && styles.playerNameWinner, placeholder && styles.playerNamePlaceholder]}
        numberOfLines={1}
      >
        {namn}
      </Text>
      <Text style={[styles.playerScore, winner && styles.playerNameWinner]}>{poang != null ? poang : '–'}</Text>
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

  seasonBar: { flexGrow: 0, marginBottom: 14 },
  seasonChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginRight: 8,
    elevation: 1,
  },
  seasonChipActive: { backgroundColor: GREEN },
  seasonChipText: { fontSize: 13, fontWeight: '600', color: '#666' },
  seasonChipTextActive: { color: '#fff' },

  aktivBanner: {
    backgroundColor: '#FFEBEE',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#EF9A9A',
    alignItems: 'center',
  },
  aktivBannerLabel: { fontSize: 13, fontWeight: '700', color: '#C62828' },
  aktivBannerNames: { fontSize: 16, fontWeight: '700', color: '#333', marginTop: 4 },

  matchBanner: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  matchBannerLabel: { fontSize: 13, fontWeight: '700' },
  matchBannerTitle: { fontSize: 12, fontWeight: '600', color: '#777', marginTop: 2 },
  matchBannerNames: { fontSize: 16, fontWeight: '700', color: '#333', marginTop: 2 },

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
    marginBottom: 10,
    overflow: 'hidden',
  },
  matchBoxActive: {
    borderColor: RED,
    borderWidth: 2,
  },
  matchBoxNasta: {
    borderColor: ORANGE,
    borderWidth: 2,
  },
  matchTag: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 3,
  },
  matchTagActive: { backgroundColor: RED },
  matchTagNasta: { backgroundColor: ORANGE },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fafafa',
  },
  playerRowWinner: { backgroundColor: '#E8F5E9' },
  playerName: { fontSize: 14, color: '#555', flex: 1 },
  playerNameWinner: { color: GREEN, fontWeight: '700' },
  playerNamePlaceholder: { color: '#aaa', fontStyle: 'italic' },
  playerScore: { fontSize: 14, fontWeight: '600', color: '#555', marginLeft: 8 },
});
