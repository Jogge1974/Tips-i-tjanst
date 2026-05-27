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
import { useAuth } from '../context/AuthContext';
import { api, GameStatus } from '../services/api';

export default function HomeScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [myPosition, setMyPosition] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState<number>(0);
  const [myPoang, setMyPoang] = useState<number | null>(null);
  const [slutspelsInfo, setSlutspelsInfo] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [statusData, allsvenskanData] = await Promise.all([
        api.getStatus(),
        api.getTipsAllsvenskan(user.id),
      ]);
      setStatus(statusData);
      setMyPosition(allsvenskanData.myPosition);
      setTotalPlayers(allsvenskanData.standings?.length || 0);
      const standings = allsvenskanData.standings || [];
      const myEntry = standings.find((s: any) => s.id === user.id);
      setMyPoang(myEntry ? myEntry.poang : null);

      // Calculate distance to/from slutspelsplats (top 8)
      const pos = allsvenskanData.myPosition;
      if (pos && myEntry && standings.length >= 8) {
        if (pos <= 8) {
          const ninthEntry = standings[8]; // index 8 = plats 9
          if (ninthEntry) {
            const diff = (myEntry.poang - ninthEntry.poang).toFixed(1);
            setSlutspelsInfo(`${diff}p ner till plats 9`);
          } else {
            setSlutspelsInfo('Slutspelsplats!');
          }
        } else {
          const eighthEntry = standings[7]; // index 7 = plats 8
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

  // Determine action card content
  let actionTitle = '';
  let actionSubtitle = '';
  let actionIcon = '';
  let actionTarget = '';

  if (status) {
    if (status.speletOppet === 1) {
      actionTitle = 'Tippa veckans match';
      actionSubtitle = 'Lämna ditt tipstecken för din tilldelade match';
      actionIcon = '🎯';
      actionTarget = 'MinSida';
    } else if (status.speletOppet === 2 && status.isSlutspel === 0) {
      actionTitle = 'Tippa garderingar';
      actionSubtitle = 'Välj 10 garderingar för veckans kupong';
      actionIcon = '🃏';
      actionTarget = 'MinSida';
    } else if (status.speletOppet === 2 && status.isSlutspel === 1) {
      actionTitle = 'Tippa enkelrad';
      actionSubtitle = 'Lämna din enkelrad med garderingar';
      actionIcon = '📝';
      actionTarget = 'MinSida';
    } else if (status.speletOppet === 0 && status.antalRatt === 0) {
      actionTitle = 'Till LIVE-vyn';
      actionSubtitle = 'Följ omgångens matcher live';
      actionIcon = '⚽';
      actionTarget = 'Live';
    } else if (status.speletOppet === 0 && status.antalRatt > 0) {
      actionTitle = 'Väntar på nästa omgång';
      actionSubtitle = `Omgång ${status.spelomgang} är avgjord`;
      actionIcon = '⏳';
      actionTarget = '';
    }
  }

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

      {/* Action card */}
      {actionTitle && (
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => actionTarget && navigation.navigate(actionTarget)}
          activeOpacity={actionTarget ? 0.8 : 1}
          disabled={!actionTarget}
        >
          <Text style={styles.actionIcon}>{actionIcon}</Text>
          <Text style={styles.actionTitle}>{actionTitle}</Text>
          <Text style={styles.actionSubtitle}>{actionSubtitle}</Text>
          {actionTarget && <Text style={styles.actionArrow}>Gå till →</Text>}
        </TouchableOpacity>
      )}

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
  greeting: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1B5E20',
    marginBottom: 20,
  },
  heroCard: {
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 20,
  },
  heroBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    opacity: 0.12,
  },
  heroBgEmoji: {
    fontSize: 80,
  },
  heroBgEmoji2: {
    fontSize: 60,
  },
  heroLogo: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  heroLogoImg: {
    width: 280,
    height: 120,
  },
  heroLogoAccent: {
    color: '#FFD700',
    fontWeight: '900',
  },
  heroGreeting: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E8F5E9',
    marginBottom: 4,
  },
  heroSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
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
  actionCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  actionIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
    textAlign: 'center',
  },
  actionSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
  },
  actionArrow: {
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
