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
import { api, GameStatus } from '../services/api';

export default function HomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [hasTipped, setHasTipped] = useState(false);
  const [hasGardering, setHasGardering] = useState(false);
  const [liveData, setLiveData] = useState<any>(null);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState<number>(0);
  const [myPoang, setMyPoang] = useState<number | null>(null);
  const [slutspelsInfo, setSlutspelsInfo] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [statusData, allsvenskanData, myMatch, garderingar, live] = await Promise.all([
        api.getStatus(),
        api.getTipsAllsvenskan(user.id),
        api.getMyMatch(user.id),
        api.getGarderingar(user.id),
        api.getLiveDraw(),
      ]);
      setStatus(statusData);
      setLiveData(live);

      // Check if user has tipped
      if (myMatch && (myMatch.etta === '1' || myMatch.kryss === '1' || myMatch.tvaa === '1')) {
        setHasTipped(true);
      } else {
        setHasTipped(false);
      }

      // Check if user has saved garderingar
      setHasGardering(Array.isArray(garderingar) && garderingar.length > 0);

      // TipsAllsvenskan position
      setMyPosition(allsvenskanData.myPosition);
      setTotalPlayers(allsvenskanData.standings?.length || 0);
      const standings = allsvenskanData.standings || [];
      const myEntry = standings.find((s: any) => s.id === user.id);
      setMyPoang(myEntry ? myEntry.poang : null);

      const pos = allsvenskanData.myPosition;
      if (pos && myEntry && standings.length >= 8) {
        if (pos <= 8) {
          const ninthEntry = standings[8];
          if (ninthEntry) {
            const diff = (myEntry.poang - ninthEntry.poang).toFixed(1);
            setSlutspelsInfo(`${diff}p ner till plats 9`);
          } else {
            setSlutspelsInfo('Slutspelsplats!');
          }
        } else {
          const eighthEntry = standings[7];
          if (eighthEntry) {
            const diff = (eighthEntry.poang - myEntry.poang).toFixed(1);
            setSlutspelsInfo(`${diff}p upp till plats 8`);
          }
        }
      }
    } catch (e) {
      console.error('Home fetch error:', e);
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

  // Determine which card to show
  const renderStatusCard = () => {
    if (!status) return null;

    // A. Game is open (speletOppet = 1 or 2)
    if (status.speletOppet === 1 || status.speletOppet === 2) {
      const tipsActive = status.speletOppet === 1;
      const garderingActive = status.speletOppet === 2;
      const garderingLabel = status.isSlutspel ? 'Lämna enkelrad' : 'Lämna garderingar';

      return (
        <TouchableOpacity
          style={styles.taskCard}
          onPress={() => navigation.navigate('MinSida')}
          activeOpacity={0.8}
        >
          <Text style={styles.taskHeader}>Veckans uppgifter</Text>
          <Text style={styles.taskRound}>Omgång {status.spelomgang}</Text>

          {/* Task 1: Lämna tips */}
          <View style={[styles.taskRow, !tipsActive && styles.taskRowDisabled]}>
            <View style={[styles.taskIcon, hasTipped && styles.taskIconDone]}>
              {hasTipped ? (
                <Ionicons name="checkmark" size={18} color="#fff" />
              ) : (
                <Ionicons name="ellipse-outline" size={18} color={tipsActive ? '#1B5E20' : '#ccc'} />
              )}
            </View>
            <View style={styles.taskTextContainer}>
              <Text style={[styles.taskLabel, !tipsActive && styles.taskLabelDisabled]}>
                Lämna tips
              </Text>
              <Text style={styles.taskDescription}>
                {hasTipped ? 'Tipstecken lämnat ✓' : tipsActive ? 'Lämna ditt tipstecken' : 'Öppnar tisdag'}
              </Text>
            </View>
            {tipsActive && !hasTipped && (
              <Ionicons name="chevron-forward" size={20} color="#1B5E20" />
            )}
          </View>

          {/* Task 2: Lämna garderingar/enkelrad */}
          <View style={[styles.taskRow, !garderingActive && styles.taskRowDisabled]}>
            <View style={[styles.taskIcon, hasGardering && styles.taskIconDone]}>
              {hasGardering ? (
                <Ionicons name="checkmark" size={18} color="#fff" />
              ) : (
                <Ionicons name="ellipse-outline" size={18} color={garderingActive ? '#1B5E20' : '#ccc'} />
              )}
            </View>
            <View style={styles.taskTextContainer}>
              <Text style={[styles.taskLabel, !garderingActive && styles.taskLabelDisabled]}>
                {garderingLabel}
              </Text>
              <Text style={styles.taskDescription}>
                {hasGardering ? 'Garderingar sparade ✓' : garderingActive ? 'Lämna före fredag kl 12' : 'Öppnar torsdag kl 12'}
              </Text>
            </View>
            {garderingActive && !hasGardering && (
              <Ionicons name="chevron-forward" size={20} color="#1B5E20" />
            )}
          </View>

          <Text style={styles.taskFooter}>Tryck för att gå till Min sida →</Text>
        </TouchableOpacity>
      );
    }

    // B, C, D: speletOppet === 0
    if (status.speletOppet === 0 && liveData) {
      const events = liveData.events || [];
      const started = events.filter((e: any) => e.sportEventStatus !== 'Inte startat');
      const finished = events.filter((e: any) =>
        e.sportEventStatus === 'Slut' || e.sportEventStatus === 'Avslutad'
      );
      const allFinished = finished.length === 13;
      const noneStarted = started.length === 0;

      // B. All matches finished - show result
      if (allFinished) {
        return (
          <TouchableOpacity
            style={styles.resultCard}
            onPress={() => navigation.navigate('Live')}
            activeOpacity={0.8}
          >
            <Ionicons name="trophy" size={48} color="#FFD700" style={styles.resultIcon} />
            <Text style={styles.resultTitle}>Omgång {status.spelomgang} avgjord</Text>
            <Text style={styles.resultRatt}>{status.antalRatt} rätt</Text>
            {liveData.distribution && liveData.distribution.length > 0 && (
              <Text style={styles.resultVinst}>
                Se resultat och eventuell vinst
              </Text>
            )}
            <Text style={styles.taskFooter}>Tryck för detaljer →</Text>
          </TouchableOpacity>
        );
      }

      // C. No matches started
      if (noneStarted) {
        return (
          <TouchableOpacity
            style={styles.waitingCard}
            onPress={() => navigation.navigate('Live')}
            activeOpacity={0.8}
          >
            <Ionicons name="time-outline" size={48} color="#1B5E20" style={styles.resultIcon} />
            <Text style={styles.waitingTitle}>Vi väntar på att Stryktipset ska starta</Text>
            <Text style={styles.waitingSubtitle}>Omgång {status.spelomgang}</Text>
            <Text style={styles.taskFooter}>Tryck för att se kupongen →</Text>
          </TouchableOpacity>
        );
      }

      // D. At least one match started (live)
      return (
        <TouchableOpacity
          style={styles.liveCard}
          onPress={() => navigation.navigate('Live')}
          activeOpacity={0.8}
        >
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
          <Text style={styles.liveTitle}>Stryktipset är LIVE</Text>
          <Text style={styles.liveSubtitle}>Följ spelet här</Text>
          <Text style={styles.liveProgress}>
            {finished.length} av 13 matcher klara
          </Text>
          <Text style={styles.taskFooter}>Tryck för att följa live →</Text>
        </TouchableOpacity>
      );
    }

    return null;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Hero header */}
      <View style={styles.heroCard}>
        <Image source={require('../../assets/logga_transparent.png')} style={styles.heroLogoImg} resizeMode="contain" />
      </View>

      {/* Dynamic status card */}
      {renderStatusCard()}

      {/* TipsAllsvenskan position card */}
      {myPosition && (
        <TouchableOpacity
          style={styles.positionCard}
          onPress={() => navigation.navigate('TipsAllsvenskan')}
          activeOpacity={0.8}
        >
          <Text style={styles.positionIcon}>🏆</Text>
          <Text style={styles.positionRank}>Plats {myPosition} av {totalPlayers}</Text>
          {myPoang !== null && (
            <Text style={styles.positionPoints}>{myPoang.toFixed(1)} poäng</Text>
          )}
          {slutspelsInfo !== '' && (
            <Text style={styles.slutspelsText}>{slutspelsInfo}</Text>
          )}
          <Text style={styles.positionArrow}>Visa tabell →</Text>
        </TouchableOpacity>
      )}

      {/* Footer */}
      <Text style={styles.footerText}>Inloggad som: {user?.fornamn} {user?.efternamn}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroCard: {
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 20,
  },
  heroLogoImg: {
    width: 280,
    height: 120,
  },

  // Task card (A)
  taskCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  taskHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1B5E20',
    marginBottom: 4,
  },
  taskRound: {
    fontSize: 13,
    color: '#888',
    marginBottom: 16,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  taskRowDisabled: {
    opacity: 0.45,
  },
  taskIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#1B5E20',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  taskIconDone: {
    backgroundColor: '#1B5E20',
    borderColor: '#1B5E20',
  },
  taskTextContainer: {
    flex: 1,
  },
  taskLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  taskLabelDisabled: {
    color: '#999',
  },
  taskDescription: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  taskFooter: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1B5E20',
    textAlign: 'center',
    marginTop: 16,
  },

  // Result card (B)
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  resultIcon: {
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  resultRatt: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1B5E20',
    marginBottom: 4,
  },
  resultVinst: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },

  // Waiting card (C)
  waitingCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  waitingTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 6,
  },
  waitingSubtitle: {
    fontSize: 14,
    color: '#888',
  },

  // Live card (D)
  liveCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#E53935',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E53935',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 6,
  },
  liveBadgeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
  },
  liveTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  liveSubtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 8,
  },
  liveProgress: {
    fontSize: 13,
    color: '#888',
  },

  // Position card
  positionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  positionIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  positionRank: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1B5E20',
    marginBottom: 4,
  },
  positionPoints: {
    fontSize: 15,
    color: '#555',
    marginBottom: 4,
  },
  slutspelsText: {
    fontSize: 13,
    color: '#888',
    marginBottom: 8,
  },
  positionArrow: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1B5E20',
    marginTop: 4,
  },
  footerText: {
    fontSize: 11,
    color: '#bbb',
    textAlign: 'center',
    marginTop: 30,
  },
});
