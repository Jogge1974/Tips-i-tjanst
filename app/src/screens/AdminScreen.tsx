import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';

const API_BASE_URL = 'https://tipstjanst-api-bpdxhah7f9hxhpce.westeurope-01.azurewebsites.net/api/api';

interface AdminMatch {
  matchNr: number;
  lag: string;
  liga: string;
  home: string;
  away: string;
  odds1: string;
  oddsX: string;
  odds2: string;
  ansvarigId: number | null;
  fornamn: string | null;
  efternamn: string | null;
  grundtecken: string | null;
  evGardering: string | null;
  poangGrund: number | null;
  gard1: number;
  gardX: number;
  gard2: number;
}

interface AdminData {
  spelomgang: string;
  speletOppet: number;
  isSlutspel: number;
  matches: AdminMatch[];
}

export default function AdminScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<AdminData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [speletOppet, setSpeletOppet] = useState(false);
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [analysisModal, setAnalysisModal] = useState<{
    visible: boolean; home: any; away: any; standings: any[]; league: string;
    eventHome: string; eventAway: string; loading: boolean;
  }>({ visible: false, home: null, away: null, standings: [], league: '', eventHome: '', eventAway: '', loading: false });

  const loadData = useCallback(async () => {
    if (!user || user.id !== 1) return;
    try {
      const resp = await fetch(`${API_BASE_URL}?action=getAdminData&userId=${user.id}`);
      const json = await resp.json();
      if (json.error) {
        Alert.alert('Fel', json.error);
        return;
      }
      setData(json);
      setSpeletOppet(json.speletOppet === 1);
      setMatches(json.matches || []);
      setHasChanges(false);
    } catch (err: any) {
      Alert.alert('Fel', err.message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const toggleSpeletOppet = async (value: boolean) => {
    setSpeletOppet(value);
    try {
      const resp = await fetch(`${API_BASE_URL}?action=setSpeletOppet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user!.id, speletOppet: value ? 1 : 0 }),
      });
      const json = await resp.json();
      if (!json.success) Alert.alert('Fel', json.error || 'Kunde inte ändra');
    } catch (err: any) {
      Alert.alert('Fel', err.message);
      setSpeletOppet(!value);
    }
  };

  const toggleGrundtecken = (matchNr: number, tecken: string) => {
    setMatches(prev => prev.map(m => {
      if (m.matchNr !== matchNr) return m;
      const current = m.grundtecken;
      const newTecken = current === tecken ? null : tecken;
      // Remove new grundtecken from gardering if it was there
      let evGardering = m.evGardering || '';
      if (newTecken) {
        evGardering = evGardering.replace(newTecken, '');
      }
      return { ...m, grundtecken: newTecken, evGardering };
    }));
    setHasChanges(true);
  };

  const toggleGardering = (matchNr: number, tecken: string) => {
    setMatches(prev => prev.map(m => {
      if (m.matchNr !== matchNr) return m;
      if (m.grundtecken === tecken) return m;
      const current = m.evGardering || '';
      const has = current.includes(tecken);
      const newGard = has ? current.replace(tecken, '') : current + tecken;
      return { ...m, evGardering: newGard };
    }));
    setHasChanges(true);
  };

  const toggleSTMF = (matchNr: number) => {
    setMatches(prev => prev.map(m => {
      if (m.matchNr !== matchNr) return m;
      return { ...m, poangGrund: m.poangGrund === 1 ? 0 : 1 };
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload = matches.map(m => ({
        matchNr: m.matchNr,
        tecken: m.grundtecken || '',
        evGardering: m.evGardering || '',
        poangGrund: m.poangGrund || 0,
        ansvarigId: m.ansvarigId || 0,
      }));
      const resp = await fetch(`${API_BASE_URL}?action=saveAdminTipsrad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, matches: payload }),
      });
      const json = await resp.json();
      if (json.success) {
        Alert.alert('Sparat', 'Tipsraden sparad!');
        setHasChanges(false);
      } else {
        Alert.alert('Fel', json.error || 'Kunde inte spara');
      }
    } catch (err: any) {
      Alert.alert('Fel', err.message);
    } finally {
      setSaving(false);
    }
  };

  const openAnalysis = async (match: AdminMatch) => {
    const home = match.home || '';
    const away = match.away || '';
    const league = match.liga || '';
    setAnalysisModal({ visible: true, home: null, away: null, standings: [], league, eventHome: home, eventAway: away, loading: true });
    try {
      const resp = await fetch(`${API_BASE_URL}?action=getMatchAnalysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, home, away }),
      });
      const json = await resp.json();
      setAnalysisModal(prev => ({
        ...prev,
        home: json.home || null,
        away: json.away || null,
        standings: json.standings || [],
        loading: false,
      }));
    } catch {
      setAnalysisModal(prev => ({ ...prev, loading: false }));
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1B5E20" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Kunde inte ladda admindata</Text>
      </View>
    );
  }

  const grundradComplete = matches.every(m => m.grundtecken);
  const totalGarderingar = matches.reduce((sum, m) => sum + (m.evGardering?.length || 0), 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>⚙️ Admin</Text>
        <Text style={styles.headerSub}>Omgång {data.spelomgang}</Text>
      </View>

      {/* Spelet öppet/stängt switch */}
      <View style={styles.switchCard}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Spelet öppet</Text>
          <Switch
            value={speletOppet}
            onValueChange={toggleSpeletOppet}
            trackColor={{ false: '#ccc', true: '#81C784' }}
            thumbColor={speletOppet ? '#1B5E20' : '#999'}
          />
        </View>
        <Text style={styles.switchStatus}>
          {speletOppet ? '🟢 Tips/garderingar öppet' : '🔴 Stängt – admin-läge'}
        </Text>
      </View>

      {/* Status summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Grundrad:</Text>
          <Text style={[styles.summaryValue, { color: grundradComplete ? '#1B5E20' : '#D32F2F' }]}>
            {matches.filter(m => m.grundtecken).length} / 13
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Garderingar:</Text>
          <Text style={styles.summaryValue}>{totalGarderingar} tecken</Text>
        </View>
        {hasChanges && (
          <Text style={styles.unsavedText}>⚠ Osparade ändringar</Text>
        )}
      </View>

      {/* Match list */}
      <View style={styles.matchCard}>
        <View style={styles.colHeader}>
          <Text style={[styles.colHeaderText, { width: 28 }]}>#</Text>
          <Text style={[styles.colHeaderText, { flex: 1 }]}>Match</Text>
          <Text style={[styles.colHeaderText, { width: 90 }]}>Grund</Text>
          <Text style={[styles.colHeaderText, { width: 90 }]}>Gard</Text>
          <Text style={[styles.colHeaderText, { width: 28 }]}>SM</Text>
        </View>

        {matches.map((match, idx) => {
          const grund = match.grundtecken;
          const gard = match.evGardering || '';
          const isSTMF = match.poangGrund === 1;
          const hasTips = !!grund;
          const lowestOdds = getLowestOdds(match);

          return (
            <View key={match.matchNr} style={[styles.matchRow, idx % 2 === 0 && styles.matchRowAlt]}>
              <Text style={styles.matchNr}>{match.matchNr}</Text>

              <TouchableOpacity style={styles.matchInfo} onPress={() => openAnalysis(match)}>
                <Text style={styles.matchLag} numberOfLines={1}>{match.lag || `${match.home} - ${match.away}`}</Text>
                <View style={styles.oddsRow}>
                  <Text style={[styles.oddsText, lowestOdds === '1' && styles.oddsHighlight]}>
                    {Number(match.odds1).toFixed(2)}
                  </Text>
                  <Text style={[styles.oddsText, lowestOdds === 'X' && styles.oddsHighlight]}>
                    {Number(match.oddsX).toFixed(2)}
                  </Text>
                  <Text style={[styles.oddsText, lowestOdds === '2' && styles.oddsHighlight]}>
                    {Number(match.odds2).toFixed(2)}
                  </Text>
                </View>
                {match.fornamn && (
                  <Text style={[styles.ansvarigText, !hasTips && styles.ansvarigMissing]}>
                    {hasTips ? match.fornamn : `⚠ ${match.fornamn} ej tippat`}
                  </Text>
                )}
                {!match.fornamn && (
                  <Text style={styles.ansvarigMissing}>Ingen lottning</Text>
                )}
              </TouchableOpacity>

              {/* Grundtecken buttons */}
              <View style={styles.teckenCol}>
                {(['1', 'X', '2'] as const).map(t => {
                  const isGrund = grund === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.teckenBtn, isGrund && styles.teckenBtnGrund]}
                      onPress={() => toggleGrundtecken(match.matchNr, t)}
                    >
                      <Text style={[styles.teckenBtnText, isGrund && styles.teckenBtnTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Gardering buttons */}
              <View style={styles.teckenCol}>
                {(['1', 'X', '2'] as const).map(t => {
                  const isGrund = grund === t;
                  const isGard = gard.includes(t);
                  const gardCount = t === '1' ? match.gard1 : t === 'X' ? match.gardX : match.gard2;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.gardBtn,
                        isGrund && styles.teckenBtnDisabled,
                        isGard && styles.teckenBtnGard,
                      ]}
                      onPress={() => toggleGardering(match.matchNr, t)}
                      disabled={isGrund}
                    >
                      <Text style={[
                        styles.gardBtnLabel,
                        isGrund && styles.teckenBtnTextDisabled,
                        isGard && styles.gardBtnLabelActive,
                      ]}>{t}</Text>
                      <Text style={[
                        styles.gardBtnCount,
                        isGrund && styles.teckenBtnTextDisabled,
                        isGard && styles.gardBtnCountActive,
                      ]}>{gardCount}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* STMF toggle */}
              <TouchableOpacity
                style={[styles.stmfBtn, isSTMF && styles.stmfBtnActive]}
                onPress={() => toggleSTMF(match.matchNr)}
              >
                <Text style={[styles.stmfText, isSTMF && styles.stmfTextActive]}>
                  {isSTMF ? '!' : '·'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* Save button */}
      <TouchableOpacity
        style={[styles.saveBtn, !hasChanges && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!hasChanges || saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveBtnText}>
            {hasChanges ? 'Spara ändringar' : 'Inga ändringar'}
          </Text>
        )}
      </TouchableOpacity>

      {/* Analysis Modal */}
      <Modal visible={analysisModal.visible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent} contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={styles.modalTitle}>
              {analysisModal.eventHome} vs {analysisModal.eventAway}
            </Text>
            <Text style={styles.modalLeague}>{analysisModal.league}</Text>

            {analysisModal.loading ? (
              <ActivityIndicator color="#1B5E20" style={{ marginVertical: 24 }} />
            ) : (
              <>
                {[analysisModal.home, analysisModal.away].map((team, i) => (
                  team ? (
                    <View key={i} style={styles.teamCard}>
                      {team.logo && <Image source={{ uri: team.logo }} style={styles.teamLogo} />}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.teamName}>#{team.position} {team.name}</Text>
                        {team.form && (
                          <View style={styles.formRow}>
                            {team.form.map((f: any, fi: number) => (
                              <View key={fi} style={[
                                styles.formBadge,
                                f.result === 'V' && styles.formWin,
                                f.result === 'O' && styles.formDraw,
                                f.result === 'F' && styles.formLoss,
                              ]}>
                                <Text style={styles.formText}>{f.result}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    </View>
                  ) : null
                ))}

                {analysisModal.standings.length > 0 && (
                  <View style={styles.standingsTable}>
                    <View style={styles.standingsHeader}>
                      <Text style={[styles.sCell, { width: 24 }]}>#</Text>
                      <Text style={[styles.sCell, { flex: 1 }]}>Lag</Text>
                      <Text style={[styles.sCell, { width: 24 }]}>S</Text>
                      <Text style={[styles.sCell, { width: 24 }]}>V</Text>
                      <Text style={[styles.sCell, { width: 24 }]}>O</Text>
                      <Text style={[styles.sCell, { width: 24 }]}>F</Text>
                      <Text style={[styles.sCell, { width: 30 }]}>P</Text>
                    </View>
                    {analysisModal.standings.map((row: any, ri: number) => {
                      const isHighlight = row.name === analysisModal.eventHome || row.name === analysisModal.eventAway;
                      return (
                        <View key={ri} style={[styles.standingsRow, isHighlight && styles.standingsHighlight]}>
                          <Text style={[styles.sCell, { width: 24 }]}>{row.position}</Text>
                          <Text style={[styles.sCell, { flex: 1 }]} numberOfLines={1}>{row.name}</Text>
                          <Text style={[styles.sCell, { width: 24 }]}>{row.played}</Text>
                          <Text style={[styles.sCell, { width: 24 }]}>{row.won}</Text>
                          <Text style={[styles.sCell, { width: 24 }]}>{row.drawn}</Text>
                          <Text style={[styles.sCell, { width: 24 }]}>{row.lost}</Text>
                          <Text style={[styles.sCell, { width: 30, fontWeight: '700' }]}>{row.points}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            <TouchableOpacity style={styles.modalClose} onPress={() => setAnalysisModal(prev => ({ ...prev, visible: false }))}>
              <Text style={styles.modalCloseText}>Stäng</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

function getLowestOdds(match: AdminMatch): string {
  const o1 = Number(match.odds1) || 99;
  const oX = Number(match.oddsX) || 99;
  const o2 = Number(match.odds2) || 99;
  if (o1 <= oX && o1 <= o2) return '1';
  if (oX <= o1 && oX <= o2) return 'X';
  return '2';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5' },
  errorText: { fontSize: 16, color: '#666' },

  header: { alignItems: 'center', paddingVertical: 16 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#1B5E20' },
  headerSub: { fontSize: 13, color: '#666', marginTop: 2 },

  switchCard: {
    backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16, marginBottom: 12,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: 16, fontWeight: '600', color: '#333' },
  switchStatus: { fontSize: 13, color: '#666', marginTop: 8 },

  summaryCard: {
    backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16, marginBottom: 12,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryLabel: { fontSize: 14, color: '#666' },
  summaryValue: { fontSize: 14, fontWeight: '700', color: '#333' },
  unsavedText: { fontSize: 12, fontWeight: '600', color: '#F57C00', marginTop: 8, textAlign: 'center' },

  matchCard: {
    backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16, marginBottom: 16,
    paddingVertical: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  colHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#E0E0E0',
  },
  colHeaderText: { fontSize: 11, fontWeight: '700', color: '#666', textAlign: 'center' },

  matchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8 },
  matchRowAlt: { backgroundColor: '#FAFAFA' },
  matchNr: { width: 28, fontSize: 13, fontWeight: '700', color: '#333', textAlign: 'center' },

  matchInfo: { flex: 1, paddingRight: 4 },
  matchLag: { fontSize: 12, fontWeight: '600', color: '#333' },
  oddsRow: { flexDirection: 'row', marginTop: 2 },
  oddsText: { fontSize: 10, color: '#999', marginRight: 8 },
  oddsHighlight: { color: '#1B5E20', fontWeight: '700' },
  ansvarigText: { fontSize: 10, color: '#888', marginTop: 1 },
  ansvarigMissing: { fontSize: 10, color: '#D32F2F', fontWeight: '600', marginTop: 1 },

  teckenCol: { width: 90, flexDirection: 'row', justifyContent: 'center', gap: 3 },
  teckenBtn: {
    width: 26, height: 34, borderRadius: 4, borderWidth: 1.5, borderColor: '#E0E0E0',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  teckenBtnGrund: { backgroundColor: '#1B5E20', borderColor: '#1B5E20' },
  teckenBtnGard: { backgroundColor: '#F57C00', borderColor: '#F57C00' },
  teckenBtnDisabled: { backgroundColor: '#E8F5E9', borderColor: '#C8E6C9' },
  teckenBtnText: { fontSize: 12, fontWeight: '700', color: '#333' },
  teckenBtnTextActive: { color: '#fff' },
  teckenBtnTextDisabled: { color: '#A5D6A7' },

  gardCountBadge: { fontSize: 8, color: '#999', position: 'absolute', bottom: 1 },
  gardCountBadgeActive: { color: 'rgba(255,255,255,0.7)' },

  gardBtn: {
    width: 26, height: 38, borderRadius: 4, borderWidth: 1.5, borderColor: '#E0E0E0',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', paddingVertical: 2,
  },
  gardBtnLabel: { fontSize: 9, fontWeight: '600', color: '#999', marginBottom: -1 },
  gardBtnLabelActive: { color: 'rgba(255,255,255,0.8)' },
  gardBtnCount: { fontSize: 14, fontWeight: '800', color: '#333' },
  gardBtnCountActive: { color: '#fff' },

  stmfBtn: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#E0E0E0',
    alignItems: 'center', justifyContent: 'center', marginLeft: 4,
  },
  stmfBtnActive: { backgroundColor: '#D32F2F', borderColor: '#D32F2F' },
  stmfText: { fontSize: 14, fontWeight: '700', color: '#ccc' },
  stmfTextActive: { color: '#fff' },

  saveBtn: {
    backgroundColor: '#1B5E20', borderRadius: 12, padding: 16, marginHorizontal: 16,
    alignItems: 'center', shadowColor: '#1B5E20', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  saveBtnDisabled: { backgroundColor: '#BDBDBD', shadowOpacity: 0, elevation: 0 },
  saveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#333', textAlign: 'center' },
  modalLeague: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 16 },
  modalClose: {
    backgroundColor: '#F5F5F5', borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 16,
  },
  modalCloseText: { fontSize: 15, fontWeight: '600', color: '#333' },

  teamCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9F9F9', borderRadius: 10, padding: 12, marginBottom: 8 },
  teamLogo: { width: 32, height: 32, marginRight: 10 },
  teamName: { fontSize: 14, fontWeight: '600', color: '#333' },
  formRow: { flexDirection: 'row', marginTop: 6, gap: 3 },
  formBadge: { width: 22, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E0E0E0' },
  formWin: { backgroundColor: '#4CAF50' },
  formDraw: { backgroundColor: '#FFC107' },
  formLoss: { backgroundColor: '#F44336' },
  formText: { fontSize: 10, fontWeight: '700', color: '#fff' },

  standingsTable: { marginTop: 12 },
  standingsHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#E0E0E0' },
  standingsRow: { flexDirection: 'row', paddingVertical: 5 },
  standingsHighlight: { backgroundColor: '#E8F5E9' },
  sCell: { fontSize: 11, color: '#333', textAlign: 'center' },
});
