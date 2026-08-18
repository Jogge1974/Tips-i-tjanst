import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { api, SlutspelData } from '../services/api';

interface DashboardData {
  status: { speletOppet: number; spelomgang: string; isSlutspel: number; antalRatt: number };
  seasonEconomy: { totalInsats: number; totalVinst: number; balance: number; sasong: number };
  leader: { namn: string; poang: number } | null;
  myPosition: number | null;
  myPoang: number | null;
  slutspelsInfo: string;
  lastResult: { spelomgang: string; antalRatt: number; insats: number; vinst: number; extraInsats: number; extraVinst: number } | null;
  streak: number;
  hasTipped: boolean;
  hasGardering: boolean;
  liveState: 'waiting' | 'live' | 'finished';
  radPublicerad?: boolean;
  message?: string;
}

function getCountdown(speletOppet: number, isSlutspel: number): string {
  const now = new Date();
  const swe = new Date(now.getTime() + 2 * 60 * 60 * 1000); // UTC+2
  let target: Date;

  if (!isSlutspel && speletOppet === 1) {
    // Tips open → deadline Thursday 12:00
    target = new Date(swe);
    const day = target.getDay();
    let daysToThu = (4 - day + 7) % 7;
    if (daysToThu === 0 && target.getHours() >= 12) daysToThu = 7;
    target.setDate(target.getDate() + daysToThu);
    target.setHours(12, 0, 0, 0);
  } else if (isSlutspel || speletOppet === 2) {
    // Gardering/enkelrad open → deadline Friday 12:00
    target = new Date(swe);
    const day = target.getDay();
    let daysToFri = (5 - day + 7) % 7;
    if (daysToFri === 0 && target.getHours() >= 12) daysToFri = 7;
    target.setDate(target.getDate() + daysToFri);
    target.setHours(12, 0, 0, 0);
  } else {
    return '';
  }

  const diff = target.getTime() - swe.getTime();
  if (diff <= 0) return '';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  return `${hours}h ${minutes}min`;
}

export default function HomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [slutspel, setSlutspel] = useState<SlutspelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const dashboard = await api.getDashboard(user.id);
      setData(dashboard);
      if (dashboard?.status?.isSlutspel === 1) {
        try {
          setSlutspel(await api.getSlutspel());
        } catch { /* ignore slutspel fetch errors */ }
      } else {
        setSlutspel(null);
      }
    } catch (e) {
      console.error('Dashboard fetch error:', e);
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

  if (!data) return null;

  const { status, seasonEconomy, leader, myPosition, myPoang, slutspelsInfo, lastResult, streak, hasTipped, hasGardering, liveState } = data;
  const countdown = getCountdown(status.speletOppet, status.isSlutspel);
  const adminMessage = (data.message || '').trim();

  const renderStatusBanner = () => {
    // Slutspel: enkelrad lämnas hela veckan (fram t.o.m. fredag kl 12)
    if (status.isSlutspel === 1 && (status.speletOppet === 1 || status.speletOppet === 2)) {
      return (
        <TouchableOpacity
          style={[styles.statusBanner, hasTipped ? styles.bannerDone : styles.bannerGardering]}
          onPress={() => navigation.navigate('MinSida')}
          activeOpacity={0.8}
        >
          <View style={styles.bannerLeft}>
            <Ionicons name={hasTipped ? 'checkmark-circle' : 'create'} size={28} color="#fff" />
          </View>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>
              {hasTipped ? 'Enkelrad lämnad ✓' : 'Lämna enkelrad'}
            </Text>
            <Text style={styles.bannerSub}>
              {hasTipped ? `Omgång ${status.spelomgang}` : `Spelstopp om ${countdown}`}
            </Text>
          </View>
          {!hasTipped && <Ionicons name="chevron-forward" size={24} color="#fff" />}
        </TouchableOpacity>
      );
    }

    if (status.speletOppet === 1) {
      return (
        <TouchableOpacity
          style={[styles.statusBanner, hasTipped ? styles.bannerDone : styles.bannerActive]}
          onPress={() => navigation.navigate('MinSida')}
          activeOpacity={0.8}
        >
          <View style={styles.bannerLeft}>
            <Ionicons
              name={hasTipped ? 'checkmark-circle' : 'pencil'}
              size={28}
              color="#fff"
            />
          </View>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>
              {hasTipped ? 'Tips lämnat ✓' : 'Lämna ditt tips'}
            </Text>
            <Text style={styles.bannerSub}>
              {hasTipped ? `Omgång ${status.spelomgang}` : `Spelstopp om ${countdown}`}
            </Text>
          </View>
          {!hasTipped && <Ionicons name="chevron-forward" size={24} color="#fff" />}
        </TouchableOpacity>
      );
    }

    if (status.speletOppet === 2) {
      const label = status.isSlutspel ? 'Lämna enkelrad' : 'Lämna garderingar';
      return (
        <TouchableOpacity
          style={[styles.statusBanner, hasGardering ? styles.bannerDone : styles.bannerGardering]}
          onPress={() => navigation.navigate('MinSida')}
          activeOpacity={0.8}
        >
          <View style={styles.bannerLeft}>
            <Ionicons
              name={hasGardering ? 'checkmark-circle' : 'layers'}
              size={28}
              color="#fff"
            />
          </View>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>
              {hasGardering ? 'Garderingar sparade ✓' : label}
            </Text>
            <Text style={styles.bannerSub}>
              {hasGardering ? `Omgång ${status.spelomgang}` : `Stänger om ${countdown}`}
            </Text>
          </View>
          {!hasGardering && <Ionicons name="chevron-forward" size={24} color="#fff" />}
        </TouchableOpacity>
      );
    }

    // Game closed
    if (liveState === 'live') {
      return (
        <TouchableOpacity
          style={[styles.statusBanner, styles.bannerLive]}
          onPress={() => navigation.navigate('Live')}
          activeOpacity={0.8}
        >
          <View style={styles.bannerLeft}>
            <View style={styles.liveDot} />
          </View>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitle}>Stryktipset är LIVE</Text>
            <Text style={styles.bannerSub}>Följ spelet här →</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#fff" />
        </TouchableOpacity>
      );
    }

    // Round finished
    if (liveState === 'finished') {
      return (
        <TouchableOpacity
          style={[styles.statusBanner, styles.bannerWaiting]}
          onPress={() => navigation.navigate('Live')}
          activeOpacity={0.8}
        >
          <View style={styles.bannerLeft}>
            <Ionicons name="checkmark-done-outline" size={28} color="#1B5E20" />
          </View>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerTitleDark}>Omgången avslutad</Text>
            <Text style={styles.bannerSubDark}>Se resultatet här →</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#1B5E20" />
        </TouchableOpacity>
      );
    }

    // Waiting
    return (
      <TouchableOpacity
        style={[styles.statusBanner, styles.bannerWaiting]}
        onPress={() => navigation.navigate('Live')}
        activeOpacity={0.8}
      >
        <View style={styles.bannerLeft}>
          <Ionicons name="football-outline" size={28} color="#1B5E20" />
        </View>
        <View style={styles.bannerContent}>
          {data.radPublicerad ? (
            <>
              <Text style={styles.bannerTitleDark}>Veckans rad är publicerad</Text>
              <Text style={styles.bannerSubDark}>Omgång {status.spelomgang} – Se kupongen</Text>
            </>
          ) : (
            <>
              <Text style={styles.bannerTitleDark}>Spelet är stängt</Text>
              <Text style={styles.bannerSubDark}>Nästa omgång öppnar snart</Text>
            </>
          )}
        </View>
        <Ionicons name="chevron-forward" size={24} color="#1B5E20" />
      </TouchableOpacity>
    );
  };

  const renderSlutspelCard = () => {
    if (status.isSlutspel !== 1 || !slutspel || !slutspel.kvart) return null;

    const phaseMeta: { key: 'kvart' | 'semi' | 'final'; title: string; advanceLabel: string }[] = [
      { key: 'kvart', title: 'Kvartsfinal', advanceLabel: 'Till semifinal' },
      { key: 'semi', title: 'Semifinal', advanceLabel: 'Till final' },
      { key: 'final', title: 'Final', advanceLabel: 'Vinnare' },
    ];
    const phaseLabels: Record<string, string> = { kvart: 'Kvartsfinal', semi: 'Semifinal', final: 'Final', done: 'Avgjort' };

    const renderPhase = (meta: { key: 'kvart' | 'semi' | 'final'; title: string; advanceLabel: string }) => {
      const phase = slutspel[meta.key];
      const isActive = slutspel.currentPhase === meta.key;
      return (
        <View key={meta.key} style={styles.spPhase}>
          <View style={styles.spPhaseHeaderRow}>
            <Text style={styles.spPhaseTitle}>{meta.title}</Text>
            {isActive && (
              <View style={styles.spActiveBadge}>
                <Text style={styles.spActiveBadgeText}>{phase && phase.played ? 'KLAR' : 'PÅGÅR'}</Text>
              </View>
            )}
          </View>
          {phase && phase.entries.length > 0 ? (
            phase.entries.map((e, i) => {
              const isMe = e.id === user?.id;
              const isWinner = meta.key === 'final' && phase.played && e.advances;
              return (
                <View
                  key={`${e.id}-${i}`}
                  style={[
                    styles.spRow,
                    e.advances && styles.spRowAdvance,
                    isWinner && styles.spRowWinner,
                  ]}
                >
                  <Text style={[styles.spPos, e.advances && styles.spPosAdvance]}>{i + 1}</Text>
                  <Text style={[styles.spName, isMe && styles.spNameMe]} numberOfLines={1}>
                    {isWinner ? '🏆 ' : ''}{e.namn}{isMe ? ' (du)' : ''}
                  </Text>
                  {phase.played ? (
                    <Text style={styles.spResult}>{e.resultat}</Text>
                  ) : (
                    <Text style={styles.spPending}>–</Text>
                  )}
                </View>
              );
            })
          ) : (
            <Text style={styles.spEmpty}>Avgörs när föregående fas är klar</Text>
          )}
        </View>
      );
    };

    return (
      <View style={styles.spCard}>
        <View style={styles.spHeader}>
          <Ionicons name="trophy" size={18} color="#B8860B" />
          <Text style={styles.spTitle}>Slutspel</Text>
          <Text style={styles.spPhaseBadge}>{phaseLabels[slutspel.currentPhase || 'kvart']}</Text>
        </View>

        {slutspel.winner && (
          <View style={styles.spChampion}>
            <Text style={styles.spChampionCrown}>🏆</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.spChampionLabel}>Mästare {slutspel.sasong ? `säsong ${slutspel.sasong}` : ''}</Text>
              <Text style={styles.spChampionName}>{slutspel.winner.namn}</Text>
            </View>
          </View>
        )}

        {phaseMeta.map(renderPhase)}
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Logo */}
      <View style={styles.heroCard}>
        <Image
          source={require('../../assets/logga_transparent.png')}
          style={styles.heroLogoImg}
          resizeMode="contain"
        />
      </View>

      {/* Status banner */}
      {renderStatusBanner()}

      {/* Admin message */}
      {adminMessage !== '' && (
        <View style={styles.messageCard}>
          <View style={styles.messageHeader}>
            <Ionicons name="megaphone" size={16} color="#1B5E20" />
            <Text style={styles.messageTitle}>Meddelande från ordförarn</Text>
          </View>
          <Text style={styles.messageText}>{adminMessage}</Text>
        </View>
      )}

      {/* Slutspel bracket (endast slutspelsomgångar) */}
      {renderSlutspelCard()}

      {/* Last result card - split view */}
      {lastResult && (() => {
        const strykTot = lastResult.vinst - lastResult.insats;
        const ovrigtTot = lastResult.extraVinst - lastResult.extraInsats;
        const veckoTot = strykTot + ovrigtTot;
        return (
          <View style={styles.resultCard}>
            <Text style={styles.resultCardHeader}>Omgång {lastResult.spelomgang}</Text>
            <View style={styles.resultCardRow}>
              <View style={styles.resultCardHalf}>
                <View style={styles.resultCardTitleRow}>
                  <Text style={styles.resultCardTitle}>Stryktipset</Text>
                  <Text style={styles.resultCardRatt}>{lastResult.antalRatt} rätt</Text>
                </View>
                <View style={styles.resultCardBody}>
                  <View>
                    <Text style={styles.resultCardLine}>Insats: {lastResult.insats} kr</Text>
                    <Text style={styles.resultCardLine}>Vinst: {lastResult.vinst} kr</Text>
                  </View>
                  <Text style={[
                    styles.resultCardTotal,
                    strykTot >= 0 ? styles.positive : styles.negative,
                  ]}>{strykTot >= 0 ? '+' : ''}{strykTot} kr</Text>
                </View>
              </View>
              <View style={styles.resultCardDivider} />
              <View style={styles.resultCardHalf}>
                <View style={styles.resultCardTitleRow}>
                  <Text style={styles.resultCardTitle}>Övrigt</Text>
                </View>
                <View style={styles.resultCardBody}>
                  <View>
                    <Text style={styles.resultCardLine}>Insats: {lastResult.extraInsats} kr</Text>
                    <Text style={styles.resultCardLine}>Vinst: {lastResult.extraVinst} kr</Text>
                  </View>
                  <Text style={[
                    styles.resultCardTotal,
                    ovrigtTot >= 0 ? styles.positive : styles.negative,
                  ]}>{ovrigtTot >= 0 ? '+' : ''}{ovrigtTot} kr</Text>
                </View>
              </View>
            </View>
            <View style={styles.resultCardSummary}>
              <Text style={[
                styles.resultCardSummaryText,
                veckoTot >= 0 ? styles.positive : styles.negative,
              ]}>Vecka: {veckoTot >= 0 ? '+' : ''}{veckoTot} kr</Text>
            </View>
          </View>
        );
      })()}

      {/* Dashboard grid */}
      <View style={styles.grid}>
        {/* Season Economy */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Säsong {seasonEconomy.sasong}</Text>
          <Text style={[
            styles.cardValue,
            seasonEconomy.balance >= 0 ? styles.positive : styles.negative,
          ]}>
            {seasonEconomy.balance >= 0 ? '+' : ''}{seasonEconomy.balance} kr
          </Text>
          <View style={styles.ecoRow}>
            <Text style={styles.ecoDetail}>Insats: {seasonEconomy.totalInsats} kr</Text>
            <Text style={styles.ecoDetail}>Vinst: {seasonEconomy.totalVinst} kr</Text>
          </View>
        </View>

        {/* TipsAllsvenskan */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('TipsAllsvenskan')}
          activeOpacity={0.8}
        >
          <Text style={styles.cardLabel}>TipsAllsvenskan</Text>
          {myPosition && (
            <Text style={styles.cardValue}>Plats {myPosition}</Text>
          )}
          {myPoang !== null && (
            <Text style={styles.cardPoints}>{myPoang.toFixed(1)} poäng</Text>
          )}
          {slutspelsInfo !== '' && (
            <Text style={styles.cardMeta}>{slutspelsInfo}</Text>
          )}
          {leader && (
            <View style={styles.leaderRow}>
              <Ionicons name="trophy" size={14} color="#FFD700" />
              <Text style={styles.leaderText}>{leader.namn} ({leader.poang.toFixed(1)}p)</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Streak row */}
      {streak > 0 && (
        <View style={styles.grid}>
          <View style={styles.cardSmall}>
            <Text style={styles.cardLabel}>Streak 🔥</Text>
            <Text style={styles.cardValueMd}>{streak} omgångar</Text>
            <Text style={styles.cardMeta}>i rad med 10+ rätt</Text>
          </View>
        </View>
      )}

      {/* Footer */}
      <Text style={styles.footerText}>
        Inloggad som: {user?.fornamn} {user?.efternamn}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  heroCard: { alignItems: 'center', marginBottom: 16, paddingVertical: 12 },
  heroLogoImg: { width: 240, height: 100 },

  // Status banner
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  bannerActive: { backgroundColor: '#1B5E20' },
  bannerDone: { backgroundColor: '#4CAF50' },
  bannerGardering: { backgroundColor: '#E65100' },
  bannerLive: { backgroundColor: '#C62828' },
  bannerWaiting: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#C8E6C9' },
  bannerLeft: { marginRight: 14 },
  bannerContent: { flex: 1 },
  bannerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  bannerTitleDark: { fontSize: 17, fontWeight: '700', color: '#1B5E20' },
  bannerSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  bannerSubDark: { fontSize: 13, color: '#4CAF50', marginTop: 2 },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' },

  // Admin message card
  messageCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#1B5E20',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  messageTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1B5E20',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageText: { fontSize: 15, lineHeight: 22, color: '#333' },

  // ===== Slutspel bracket card =====
  spCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F0E3C0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  spHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  spTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#1B5E20',
    letterSpacing: 0.5,
  },
  spPhaseBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A6D00',
    backgroundColor: '#FBF3D5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  spChampion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FBF3D5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E9D28C',
  },
  spChampionCrown: { fontSize: 30 },
  spChampionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A6D00',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  spChampionName: { fontSize: 18, fontWeight: '800', color: '#1B5E20' },
  spPhase: { marginBottom: 14 },
  spPhaseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  spPhaseTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  spActiveBadge: {
    backgroundColor: '#1B5E20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  spActiveBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  spRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 3,
    backgroundColor: '#FAFAFA',
  },
  spRowAdvance: {
    backgroundColor: '#E9F5EC',
    borderLeftWidth: 3,
    borderLeftColor: '#1B5E20',
  },
  spRowWinner: {
    backgroundColor: '#FBF3D5',
    borderLeftColor: '#B8860B',
  },
  spPos: {
    width: 22,
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textAlign: 'center',
  },
  spPosAdvance: { color: '#1B5E20' },
  spName: { flex: 1, fontSize: 14, color: '#333', marginLeft: 6 },
  spNameMe: { fontWeight: '800', color: '#1B5E20' },
  spResult: { fontSize: 14, fontWeight: '800', color: '#1B5E20', minWidth: 28, textAlign: 'right' },
  spPending: { fontSize: 14, color: '#BBB', minWidth: 28, textAlign: 'right' },
  spEmpty: { fontSize: 13, color: '#999', fontStyle: 'italic', paddingVertical: 6, paddingHorizontal: 8 },

  // Grid
  grid: { flexDirection: 'row', gap: 12, marginBottom: 12 },

  // Cards
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardSmall: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardLabel: { fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: 6 },
  cardValue: { fontSize: 24, fontWeight: '800', color: '#333', marginBottom: 4 },
  cardValueMd: { fontSize: 20, fontWeight: '800', color: '#333', marginBottom: 2 },
  cardPoints: { fontSize: 14, color: '#555', marginBottom: 2 },
  cardMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  positive: { color: '#2E7D32', fontWeight: '600' },
  negative: { color: '#C62828', fontWeight: '600' },

  // Result card (split view)
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  resultCardHeader: { fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase', marginBottom: 10 },
  resultCardRow: { flexDirection: 'row' },
  resultCardHalf: { flex: 1 },
  resultCardDivider: { width: 1, backgroundColor: '#E0E0E0', marginHorizontal: 12 },
  resultCardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  resultCardTitle: { fontSize: 13, fontWeight: '700', color: '#333' },
  resultCardRatt: { fontSize: 13, fontWeight: '700', color: '#333' },
  resultCardBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultCardLine: { fontSize: 11, color: '#999', marginBottom: 2 },
  resultCardTotal: { fontSize: 13, fontWeight: '700' },
  resultCardSummary: { alignItems: 'flex-end', marginTop: 10, borderTopWidth: 1, borderTopColor: '#E0E0E0', paddingTop: 8 },
  resultCardSummaryText: { fontSize: 14, fontWeight: '700' },

  // Economy details
  ecoRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  ecoDetail: { fontSize: 11, color: '#888' },

  // Leader row
  leaderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 },
  leaderText: { fontSize: 11, color: '#666' },

  // Footer
  footerText: { fontSize: 11, color: '#bbb', textAlign: 'center', marginTop: 20 },
});
