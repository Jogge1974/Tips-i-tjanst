import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
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

interface RoundGrundtips {
  matchNr: number;
  ansvarig: string;
  tecken: string | null;
  rtecken: string | null;
  isCorrect: boolean | null;
  isSTMF: boolean;
  odds: number;
}

interface RoundGarderingEntry {
  userId: number;
  namn: string;
  ratt: number | null;
  position: number | null;
}

interface RoundData {
  roundNr: number;
  spelomgang: string;
  isSlutspel: number;
  grundtips: RoundGrundtips[];
  garderingTable: RoundGarderingEntry[];
}

export default function TipsAllsvenskanScreen() {
  const { user } = useAuth();
  const [standings, setStandings] = useState<StandingEntry[]>([]);
  const [rounds, setRounds] = useState<RoundData[]>([]);
  const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sasong, setSasong] = useState<number | null>(null);
  const [kupongModal, setKupongModal] = useState<{
    spelomgang: string;
    isSlutspel: number;
    matches: { matchNr: number; lag: string; rtecken: string | null }[];
    users: { userId: number; namn: string; ratt: number; tecken: Record<string, { t: string | null; c: boolean | null }> }[];
  } | null>(null);
  const [kupongLoading, setKupongLoading] = useState(false);
  const userId = user ? Number(user.id) : null;

  const openKupong = async (spelomgang: string) => {
    setKupongLoading(true);
    try {
      const data = await api.getAllGarderingar(spelomgang);
      setKupongModal(data);
    } catch (e) {
      console.error('Failed to load garderingar:', e);
    } finally {
      setKupongLoading(false);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      const [data, historyData] = await Promise.all([
        api.getTipsAllsvenskan(user?.id),
        api.getRoundHistory(),
      ]);
      setStandings(data.standings || []);
      setSasong(data.sasong);
      setRounds(historyData.rounds || []);
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
          <Text style={[styles.cell, styles.oddsCol, styles.headerText]}>O</Text>
          <Text style={[styles.cell, styles.numCol, styles.headerText]}>G</Text>
          <Text style={[styles.cell, styles.ptsCol, styles.headerText]}>Po</Text>
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
              <Text style={[styles.cell, styles.oddsCol, isMe && styles.myTextInTable]}>{entry.odds?.toFixed(1) ?? '0'}</Text>
              <Text style={[styles.cell, styles.numCol, isMe && styles.myTextInTable]}>{entry.gard ?? 0}</Text>
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

      {/* Round history panels */}
      {rounds.length > 0 && (
        <View style={styles.roundsSection}>
          <Text style={styles.roundsSectionTitle}>Omgångar</Text>
          {rounds.map((round) => {
            const isExpanded = !!expandedRounds[round.roundNr];
            return (
              <TouchableOpacity
                key={round.roundNr}
                style={styles.roundCard}
                activeOpacity={0.8}
                onPress={() => setExpandedRounds(prev => ({ ...prev, [round.roundNr]: !prev[round.roundNr] }))}
              >
                <View style={styles.roundHeader}>
                  <Text style={styles.roundTitle}>Omgång {round.roundNr} ({round.spelomgang})</Text>
                  <Text style={styles.roundArrow}>{isExpanded ? '▲' : '▼'}</Text>
                </View>
                {isExpanded && (
                  <View style={styles.roundContent}>
                    {/* Garderingstabell */}
                    <Text style={styles.roundSubTitle}>
                      {round.isSlutspel === 1 ? 'Enkelradstabellen' : 'Garderingstabellen'}
                    </Text>
                    {round.garderingTable.map((entry, idx) => {
                      const isLeader = entry.position === 1 && entry.ratt !== null;
                      const isSecond = entry.position === 2 && entry.ratt !== null;
                      const isThird = entry.position === 3 && entry.ratt !== null;
                      const medal = isLeader ? '🥇' : isSecond ? '🥈' : isThird ? '🥉' : null;
                      const canClick = entry.ratt !== null;
                      return (
                        <TouchableOpacity
                          key={entry.userId}
                          activeOpacity={canClick ? 0.6 : 1}
                          disabled={!canClick}
                          onPress={() => canClick && openKupong(round.spelomgang)}
                          style={[
                            styles.roundGardRow,
                            isLeader && styles.roundGardRowLeader,
                            idx < round.garderingTable.length - 1 && styles.roundGardRowBorder,
                          ]}
                        >
                          <View style={styles.roundGardPosCol}>
                            {medal ? <Text style={styles.roundGardMedal}>{medal}</Text>
                                   : <Text style={styles.roundGardPos}>{entry.position ?? '-'}</Text>}
                          </View>
                          <Text style={[styles.roundGardName, isLeader && styles.roundGardNameLeader]} numberOfLines={1}>
                            {entry.namn}
                          </Text>
                          <Text style={[
                            styles.roundGardRatt,
                            entry.ratt === null && styles.roundGardRattNull,
                            isLeader && styles.roundGardRattLeader,
                          ]}>
                            {entry.ratt !== null ? `${entry.ratt} rätt` : 'ej tippat'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Grundtipsen */}
                    <Text style={[styles.roundSubTitle, { marginTop: 16 }]}>Grundtipsen</Text>
                    {round.grundtips.map((match, idx) => (
                      <View key={match.matchNr} style={[
                        styles.roundGrundRow,
                        idx < round.grundtips.length - 1 && styles.roundGrundRowBorder,
                      ]}>
                        <Text style={styles.roundGrundNr}>{match.matchNr}</Text>
                        <Text style={styles.roundGrundNamn} numberOfLines={1}>{match.ansvarig}</Text>

                        <View style={styles.roundGrundResultCol}>
                          <Text style={[
                            styles.roundGrundResult,
                            match.isCorrect === true && styles.roundGrundResultCorrect,
                            match.isCorrect === false && styles.roundGrundResultWrong,
                          ]}>{match.rtecken || '-'}</Text>
                        </View>

                        <View style={[
                          styles.roundGrundTeckenBox,
                          match.isCorrect === true && styles.roundGrundTeckenCorrect,
                          match.isCorrect === false && styles.roundGrundTeckenWrong,
                          match.isCorrect === null && styles.roundGrundTeckenNeutral,
                        ]}>
                          <Text style={[
                            styles.roundGrundTeckenText,
                            match.isCorrect === true && styles.roundGrundTeckenTextCorrect,
                            match.isCorrect === false && styles.roundGrundTeckenTextWrong,
                          ]}>{match.tecken || '-'}</Text>
                        </View>

                        <View style={styles.roundGrundOddsCol}>
                          {match.isSTMF ? (
                            <View style={styles.roundGrundStmfBadge}>
                              <Text style={styles.roundGrundStmfText}>STMF</Text>
                            </View>
                          ) : (
                            <Text style={[
                              styles.roundGrundOdds,
                              match.odds === 0 && styles.roundGrundOddsZero,
                            ]}>{match.odds > 0 ? match.odds.toFixed(2) : '0'}</Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Kupong Modal */}
      <Modal
        visible={!!kupongModal || kupongLoading}
        transparent
        animationType="slide"
        onRequestClose={() => setKupongModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {kupongLoading ? (
              <ActivityIndicator size="large" color="#1B5E20" />
            ) : kupongModal ? (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {kupongModal.isSlutspel ? 'Enkelrader' : 'Garderingar'}
                  </Text>
                  <Text style={styles.modalSubtitle}>{kupongModal.spelomgang}</Text>
                </View>
                <ScrollView style={styles.modalScroll}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                    <View>
                      {/* Header row: match column + user columns */}
                      <View style={styles.kupongHeaderRow}>
                        <Text style={styles.kupongHeaderNr}>#</Text>
                        <Text style={styles.kupongHeaderLag}>Match</Text>
                        <View style={[styles.kupongTeckenBox, styles.kupongTeckenResultHeader]}>
                          <Text style={styles.kupongHeaderColText}>R</Text>
                        </View>
                        {kupongModal.users.map(u => (
                          <View key={u.userId} style={styles.kupongUserCol}>
                            <Text style={styles.kupongUserName} numberOfLines={1}>{u.namn.split(' ')[0]}</Text>
                            <Text style={styles.kupongUserRatt}>{u.ratt}</Text>
                          </View>
                        ))}
                      </View>
                      {/* Match rows */}
                      {kupongModal.matches.map((m, idx) => (
                        <View key={m.matchNr} style={[
                          styles.kupongRow,
                          idx < kupongModal.matches.length - 1 && styles.kupongRowBorder,
                        ]}>
                          <Text style={styles.kupongNr}>{m.matchNr}</Text>
                          <Text style={styles.kupongLag} numberOfLines={1}>{m.lag}</Text>
                          <View style={[styles.kupongTeckenBox, styles.kupongTeckenResult]}>
                            <Text style={styles.kupongTeckenResultText}>{m.rtecken || '-'}</Text>
                          </View>
                          {kupongModal.users.map(u => {
                            const cell = u.tecken[m.matchNr];
                            const t = cell?.t;
                            const c = cell?.c;
                            return (
                              <View key={u.userId} style={[
                                styles.kupongTeckenBox,
                                c === true && styles.kupongTeckenCorrect,
                                c === false && styles.kupongTeckenWrong,
                                c === null && styles.kupongTeckenNeutral,
                              ]}>
                                <Text style={[
                                  styles.kupongTeckenBoxText,
                                  c === true && styles.kupongTeckenCorrectText,
                                  c === false && styles.kupongTeckenWrongText,
                                ]}>{t || '-'}</Text>
                              </View>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </ScrollView>
                <TouchableOpacity style={styles.modalClose} onPress={() => setKupongModal(null)}>
                  <Text style={styles.modalCloseText}>Stäng</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
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
    width: 28,
    textAlign: 'center',
    color: '#777',
  },
  oddsCol: {
    width: 38,
    textAlign: 'right',
    color: '#777',
  },
  ptsCol: {
    width: 40,
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
  // Round history styles
  roundsSection: {
    marginBottom: 30,
  },
  roundsSectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1B5E20',
    marginBottom: 12,
  },
  roundCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    overflow: 'hidden',
  },
  roundHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  roundTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  roundArrow: {
    fontSize: 14,
    color: '#999',
  },
  roundContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  roundSubTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1B5E20',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Garderingstabell rows
  roundGardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  roundGardRowLeader: {
    backgroundColor: '#F1F8E9',
    borderRadius: 8,
  },
  roundGardRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  roundGardPosCol: {
    width: 28,
    alignItems: 'center',
  },
  roundGardMedal: {
    fontSize: 16,
  },
  roundGardPos: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
  },
  roundGardName: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    marginLeft: 6,
  },
  roundGardNameLeader: {
    fontWeight: '700',
    color: '#1B5E20',
  },
  roundGardRatt: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  roundGardRattNull: {
    color: '#bbb',
    fontStyle: 'italic',
    fontWeight: '400',
  },
  roundGardRattLeader: {
    color: '#1B5E20',
    fontWeight: '800',
  },
  // Grundtipsen rows
  roundGrundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
  },
  roundGrundRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  roundGrundNr: {
    width: 22,
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textAlign: 'center',
  },
  roundGrundNamn: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    marginLeft: 4,
  },
  roundGrundResultCol: {
    width: 24,
    alignItems: 'center',
  },
  roundGrundResult: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  roundGrundResultCorrect: {
    color: '#2E7D32',
  },
  roundGrundResultWrong: {
    color: '#C62828',
  },
  roundGrundTeckenBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  roundGrundTeckenCorrect: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1.5,
    borderColor: '#66BB6A',
  },
  roundGrundTeckenWrong: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1.5,
    borderColor: '#EF5350',
  },
  roundGrundTeckenNeutral: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  roundGrundTeckenText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#333',
  },
  roundGrundTeckenTextCorrect: {
    color: '#2E7D32',
  },
  roundGrundTeckenTextWrong: {
    color: '#C62828',
  },
  roundGrundOddsCol: {
    width: 50,
    alignItems: 'flex-end',
    marginLeft: 6,
  },
  roundGrundOdds: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  roundGrundOddsZero: {
    color: '#bbb',
  },
  roundGrundStmfBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  roundGrundStmfText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#E65100',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '100%',
    maxHeight: '80%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1B5E20',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalClose: {
    marginTop: 16,
    backgroundColor: '#1B5E20',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  kupongHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: '#ccc',
    marginBottom: 2,
  },
  kupongHeaderNr: {
    width: 20,
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
    textAlign: 'center',
  },
  kupongHeaderLag: {
    width: 120,
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
    marginLeft: 4,
  },
  kupongHeaderColText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1565C0',
  },
  kupongUserCol: {
    width: 28,
    alignItems: 'center',
    marginLeft: 3,
  },
  kupongUserName: {
    fontSize: 9,
    fontWeight: '600',
    color: '#555',
    textAlign: 'center',
  },
  kupongUserRatt: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1B5E20',
    marginTop: 1,
  },
  kupongTeckenResultHeader: {
    backgroundColor: '#E3F2FD',
    borderWidth: 1,
    borderColor: '#42A5F5',
    marginLeft: 0,
  },
  kupongRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 4,
  },
  kupongRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  kupongNr: {
    width: 20,
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    textAlign: 'center',
  },
  kupongLag: {
    width: 120,
    fontSize: 11,
    fontWeight: '500',
    color: '#333',
    marginLeft: 4,
  },
  kupongTeckenBox: {
    width: 28,
    height: 24,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 3,
  },
  kupongTeckenResult: {
    backgroundColor: '#E3F2FD',
    borderWidth: 1.5,
    borderColor: '#42A5F5',
    marginLeft: 0,
  },
  kupongTeckenResultText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1565C0',
  },
  kupongTeckenCorrect: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1.5,
    borderColor: '#66BB6A',
  },
  kupongTeckenCorrectText: {
    color: '#2E7D32',
  },
  kupongTeckenWrong: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1.5,
    borderColor: '#EF5350',
  },
  kupongTeckenWrongText: {
    color: '#C62828',
  },
  kupongTeckenNeutral: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  kupongTeckenBoxText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#333',
  },
});
