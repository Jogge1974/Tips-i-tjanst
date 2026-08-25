import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  ScrollView,
  RefreshControl,
  TextInput,
  Modal,
  Image,
  Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api, GameStatus, MatchInfo, Gardering } from '../services/api';

const API_BASE_URL = 'https://tipsitjanst-api.azurewebsites.net/api/api';

export default function MinSidaScreen() {
  const { user } = useAuth();
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [myMatch, setMyMatch] = useState<MatchInfo | null>(null);
  const [kupong, setKupong] = useState<MatchInfo[]>([]);
  const [garderingar, setGarderingar] = useState<Gardering[]>([]);
  const savedGarderingar = useRef<Gardering[]>([]);
  const [selectedTecken, setSelectedTecken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [saveAction, setSaveAction] = useState<'tips' | 'garderingar'>('tips');
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [analysisModal, setAnalysisModal] = useState<{
    visible: boolean; home: any; away: any; standings: any[]; league: string; eventHome: string; eventAway: string; loading: boolean;
  }>({ visible: false, home: null, away: null, standings: [], league: '', eventHome: '', eventAway: '', loading: false });
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [formModal, setFormModal] = useState<{ visible: boolean; teamName: string; matches: any[] }>({ visible: false, teamName: '', matches: [] });

  const openFormDetails = (team: any) => {
    if (!team?.form) return;
    setFormModal({ visible: true, teamName: team.name || '', matches: team.form });
  };

  const fetchAiAnalysis = async (home: string, away: string, league: string) => {
    setAiAnalysis(null);
    setAiError(null);
    setAiLoading(true);
    try {
      // Skicka med aktuell tabell-/formdata så AI:n grundar analysen på dagsfärska siffror
      const fmtTeam = (t: any) => t
        ? `${t.name}: tabellplats ${t.position ?? '?'}, ${t.played ?? 0} spelade (${t.wins ?? 0}V ${t.draws ?? 0}O ${t.losses ?? 0}F), mål ${t.goalsFor ?? 0}-${t.goalsAgainst ?? 0}, ${t.points ?? 0}p. Senaste matcher (nyast först): ${(t.form || []).map((f: any) => `${f.result} ${f.score} mot ${f.opponent}`).join(', ') || 'saknas'}`
        : '';
      const matchdata = [fmtTeam(analysisModal.home), fmtTeam(analysisModal.away)].filter(Boolean).join('\n');
      const result = await api.analyzeMatch(home, away, league, matchdata || undefined);
      if (result.error === 'rate_limit') {
        setAiError(result.message || 'Försök igen om 1 minut.');
      } else if (result.error) {
        setAiError(result.message || 'Kunde inte hämta AI-analys.');
      } else {
        setAiAnalysis(result.analysis || null);
      }
    } catch {
      setAiError('Kunde inte hämta AI-analys.');
    }
    setAiLoading(false);
  };

  const openAnalysis = async (matchInfo: MatchInfo) => {
    const teams = matchInfo.lag?.split(' - ') || matchInfo.lag?.split('-') || [];
    const home = teams[0]?.trim() || matchInfo.home || '';
    const away = teams[1]?.trim() || matchInfo.away || '';
    const league = matchInfo.liga || '';
    setFormModal(prev => ({ ...prev, visible: false }));
    setAnalysisModal({ visible: true, home: null, away: null, standings: [], league, eventHome: home, eventAway: away, loading: true });
    try {
      const resp = await fetch(`${API_BASE_URL}?action=getMatchAnalysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ league, home, away }),
      });
      const data = await resp.json();
      setAnalysisModal(prev => ({ ...prev, home: data.home, away: data.away, standings: data.standings || [], loading: false }));
    } catch {
      setAnalysisModal(prev => ({ ...prev, loading: false }));
    }
  };

  const maxGarderingar = status?.isSlutspel === 1 ? 13 : 10;

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const statusData = await api.getStatus();
      setStatus(statusData);

      const matchData = await api.getMyMatch(user.id);
      setMyMatch(matchData);

      // Sätt befintligt tipstecken om det finns, annars nollställ (ny omgång)
      if (matchData) {
        if (matchData.etta === '1') setSelectedTecken('1');
        else if (matchData.kryss === '1') setSelectedTecken('X');
        else if (matchData.tvaa === '1') setSelectedTecken('2');
        else setSelectedTecken(null);
      } else {
        setSelectedTecken(null);
      }

      // Om garderingsläge, hämta kupong och befintliga garderingar
      if (statusData.isSlutspel === 1 && statusData.speletOppet !== 0) {
        // Slutspel: enkelrad lämnas som garderingar (samma tabell), öppen hela veckan
        const [kupongData, gardData] = await Promise.all([
          api.getKupong(),
          api.getGarderingar(user.id),
        ]);
        setKupong(kupongData);
        setGarderingar(gardData);
        savedGarderingar.current = gardData;
      } else if (statusData.speletOppet === 2) {
        const [kupongData, gardData] = await Promise.all([
          api.getKupong(),
          api.getGarderingar(user.id),
        ]);
        setKupong(kupongData);
        setGarderingar(gardData);
        savedGarderingar.current = gardData;
      }
    } catch (error: any) {
      Alert.alert('Fel', error.message);
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

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  };

  const handleTeckenPress = async (tecken: string) => {
    if (!user) return;
    setSelectedTecken(tecken);
    try {
      const result = await api.saveTips(user.id, tecken);
      if (result.success) {
        showToast(`Tips uppdaterat till '${tecken}'`);
      } else {
        Alert.alert('Fel', result.error || 'Kunde inte spara');
      }
    } catch (error: any) {
      Alert.alert('Fel', error.message);
    }
  };

  const handleGarderingPress = (matchNr: number, tecken: string) => {
    setGarderingar((prev) => {
      const existing = prev.find((g) => g.matchNr === matchNr && g.tecken === tecken);
      if (existing) {
        // Ta bort gardering
        return prev.filter((g) => !(g.matchNr === matchNr && g.tecken === tecken));
      } else {
        // Ta bort annat tecken på samma match (bara en gardering per match)
        const filtered = prev.filter((g) => g.matchNr !== matchNr);
        return [...filtered, { matchNr, tecken }];
      }
    });
  };

  const handleSaveGarderingar = async () => {
    if (!user) return;
    if (garderingar.length !== maxGarderingar) {
      Alert.alert('Fel', `Du måste välja exakt ${maxGarderingar} ${status?.isSlutspel === 1 ? 'tecken' : 'garderingar'} (du har ${garderingar.length})`);
      return;
    }
    try {
      const result = await api.saveGarderingar(user.id, garderingar);
      if (result.success) {
        savedGarderingar.current = [...garderingar];
        Alert.alert('Sparat', status?.isSlutspel === 1 ? 'Din enkelrad är sparad!' : 'Dina garderingar är sparade!');
        loadData();
      } else {
        Alert.alert('Fel', result.error || 'Kunde inte spara');
      }
    } catch (error: any) {
      Alert.alert('Fel', error.message);
    }
  };

  // Slutspel: välj exakt ett tecken per match
  const handleEnkelradPress = (matchNr: number, tecken: string) => {
    setGarderingar((prev) => {
      const filtered = prev.filter((g) => g.matchNr !== matchNr);
      return [...filtered, { matchNr, tecken }];
    });
  };

  const renderAnalysisModal = () => (
    <Modal visible={analysisModal.visible} transparent animationType="slide">
      <View style={styles.analysisOverlay}>
        <View style={styles.analysisCard}>
          <View style={styles.analysisHeaderRow}>
            <Text style={styles.analysisTitle} numberOfLines={1}>
              {analysisModal.eventHome} vs {analysisModal.eventAway}
            </Text>
            <TouchableOpacity
              onPress={() => { setAnalysisModal(prev => ({ ...prev, visible: false })); setFormModal(prev => ({ ...prev, visible: false })); setAiAnalysis(null); setAiError(null); }}
              style={styles.analysisCloseX}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.analysisCloseXText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.analysisScroll} contentContainerStyle={{ paddingBottom: 12 }}>
            <Text style={styles.analysisLeague}>{analysisModal.league}</Text>

          {analysisModal.loading ? (
            <ActivityIndicator color="#1B5E20" style={{ marginVertical: 24 }} />
          ) : (
            <>
              <View style={styles.analysisTeams}>
                {[analysisModal.home, analysisModal.away].map((team, i) => (
                  team ? (
                    <TouchableOpacity key={i} style={styles.analysisTeamCard} activeOpacity={0.7} onPress={() => openFormDetails(team)}>
                      {team.logo && <Image source={{ uri: team.logo }} style={styles.teamLogo} />}
                      <View style={styles.analysisTeamInfo}>
                        <View style={styles.analysisPositionRow}>
                          <Text style={styles.analysisPosition}>#{team.position}</Text>
                          <Text style={styles.analysisTeamName}>{team.name}</Text>
                        </View>
                        {team.form && (
                          <View style={styles.formRow}>
                            {team.form.map((m: any, fi: number) => (
                              <View key={fi} style={[
                                styles.formBadge,
                                m.result === 'V' && styles.formWin,
                                m.result === 'O' && styles.formDraw,
                                m.result === 'F' && styles.formLoss,
                              ]}>
                                <Text style={styles.formBadgeText}>{m.result}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                      {team.form && <Text style={styles.analysisCardChevron}>›</Text>}
                    </TouchableOpacity>
                  ) : (
                    <View key={i} style={styles.analysisTeamCard}>
                      <Text style={styles.analysisNoData}>Tabelldata saknas</Text>
                    </View>
                  )
                ))}
              </View>

              {analysisModal.standings.length > 0 && (
                <View style={styles.standingsTable}>
                  <View style={styles.standingsHeader}>
                    <Text style={[styles.standingsCell, styles.standingsPosCol, styles.standingsHeaderText]}>#</Text>
                    <Text style={[styles.standingsCell, styles.standingsTeamCol, styles.standingsHeaderText]}>Lag</Text>
                    <Text style={[styles.standingsCell, styles.standingsNumCol, styles.standingsHeaderText]}>Sp</Text>
                    <Text style={[styles.standingsCell, styles.standingsNumCol, styles.standingsHeaderText]}>V</Text>
                    <Text style={[styles.standingsCell, styles.standingsNumCol, styles.standingsHeaderText]}>O</Text>
                    <Text style={[styles.standingsCell, styles.standingsNumCol, styles.standingsHeaderText]}>F</Text>
                    <Text style={[styles.standingsCell, styles.standingsGoalCol, styles.standingsHeaderText]}>Mål</Text>
                    <Text style={[styles.standingsCell, styles.standingsNumCol, styles.standingsHeaderText]}>Po</Text>
                  </View>
                  {analysisModal.standings.map((t: any, idx: number) => {
                    const isHighlighted = t.name === analysisModal.home?.name || t.name === analysisModal.away?.name;
                    return (
                      <View key={idx} style={[styles.standingsRow, isHighlighted && styles.standingsHighlight]}>
                        <Text style={[styles.standingsCell, styles.standingsPosCol, isHighlighted && styles.standingsHighlightText]}>{t.position}</Text>
                        <Text style={[styles.standingsCell, styles.standingsTeamCol, isHighlighted && styles.standingsHighlightText]} numberOfLines={1}>{t.name}</Text>
                        <Text style={[styles.standingsCell, styles.standingsNumCol]}>{t.played}</Text>
                        <Text style={[styles.standingsCell, styles.standingsNumCol]}>{t.wins}</Text>
                        <Text style={[styles.standingsCell, styles.standingsNumCol]}>{t.draws}</Text>
                        <Text style={[styles.standingsCell, styles.standingsNumCol]}>{t.losses}</Text>
                        <Text style={[styles.standingsCell, styles.standingsGoalCol]}>{t.goalsFor}-{t.goalsAgainst}</Text>
                        <Text style={[styles.standingsCell, styles.standingsNumCol, { fontWeight: '700' }]}>{t.points}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {!analysisModal.loading && (
            <View style={styles.aiSection}>
              {!aiAnalysis && !aiLoading && !aiError && (
                <TouchableOpacity
                  style={styles.aiBtn}
                  onPress={() => fetchAiAnalysis(analysisModal.eventHome, analysisModal.eventAway, analysisModal.league)}
                >
                  <Text style={styles.aiBtnText}>🤖 AI-analys av matchen</Text>
                </TouchableOpacity>
              )}
              {aiLoading && <ActivityIndicator color="#6A1B9A" style={{ marginVertical: 12 }} />}
              {aiError && (
                <View style={styles.aiErrorBox}>
                  <Text style={styles.aiErrorText}>{aiError}</Text>
                </View>
              )}
              {aiAnalysis && (
                <View style={styles.aiResultBox}>
                  <Text style={styles.aiResultLabel}>🤖 AI-analys</Text>
                  <Text style={styles.aiResultText}>{aiAnalysis}</Text>
                </View>
              )}
            </View>
          )}

          <TouchableOpacity
            style={styles.closeAnalysisBtn}
            onPress={() => { setAnalysisModal(prev => ({ ...prev, visible: false })); setFormModal(prev => ({ ...prev, visible: false })); setAiAnalysis(null); setAiError(null); }}
          >
            <Text style={styles.closeAnalysisBtnText}>Stäng</Text>
          </TouchableOpacity>
        </ScrollView>
        </View>

        {formModal.visible && (
        <View style={styles.formModalOverlay}>
        <View style={styles.formModalCard}>
          <View style={styles.formModalHeader}>
            <Text style={styles.formModalTitle} numberOfLines={1}>{formModal.teamName}</Text>
            <TouchableOpacity
              onPress={() => setFormModal(prev => ({ ...prev, visible: false }))}
              style={styles.formModalClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.formModalCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.formModalSub}>Senaste {formModal.matches.length} matcherna (nyast först)</Text>
          {formModal.matches.map((m: any, i: number) => {
            const dateStr = m.date ? new Date(m.date).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) : '';
            return (
              <View key={i} style={styles.formDetailRow}>
                <Text style={styles.formDetailDate}>{dateStr}</Text>
                <View style={[styles.formDetailHA, m.isHome ? styles.formDetailHome : styles.formDetailAway]}>
                  <Text style={styles.formDetailHAText}>{m.isHome ? 'H' : 'B'}</Text>
                </View>
                <Text style={styles.formDetailOpp} numberOfLines={1}>{m.opponent}</Text>
                <Text style={styles.formDetailScore}>{m.score}</Text>
                <View style={[
                  styles.formDetailBadge,
                  m.result === 'V' && styles.formWin,
                  m.result === 'O' && styles.formDraw,
                  m.result === 'F' && styles.formLoss,
                ]}>
                  <Text style={styles.formBadgeText}>{m.result}</Text>
                </View>
              </View>
            );
          })}
        </View>
        </View>
        )}
      </View>
    </Modal>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1B5E20" />
      </View>
    );
  }

  // Spelet stängt - visa match och tecken som readonly
  if (!status || status.speletOppet === 0) {
    const postedTecken = myMatch
      ? myMatch.etta === '1' ? '1' : myMatch.kryss === '1' ? 'X' : myMatch.tvaa === '1' ? '2' : null
      : null;

    return (
      <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
        <ScrollView
          style={styles.container}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Background content - visible behind overlay */}
          <View style={styles.closedBackground}>
            <Text style={styles.closedOmgang}>Omgång {status?.spelomgang || ''}</Text>

            {myMatch && (
              <View style={styles.closedMatchCard}>
                <Text style={styles.closedMatchLabel}>Din match</Text>
                <Text style={styles.closedMatchLiga}>{myMatch.liga}</Text>
                <TouchableOpacity onPress={() => openAnalysis(myMatch)}>
                  <Text style={styles.closedMatchLag}>{myMatch.matchNr}. {myMatch.lag}</Text>
                </TouchableOpacity>

                <View style={styles.closedTeckenRow}>
                  {['1', 'X', '2'].map((t) => {
                    const odds = t === '1' ? myMatch.odds1 : t === 'X' ? myMatch.oddsX : myMatch.odds2;
                    return (
                      <View
                        key={t}
                        style={[
                          styles.closedTeckenButton,
                          postedTecken === t && styles.closedTeckenActive,
                        ]}
                      >
                        <Text style={[styles.closedTeckenText, postedTecken === t && styles.closedTeckenTextActive]}>{t}</Text>
                        {odds && <Text style={[styles.closedOddsText, postedTecken === t && styles.closedOddsTextActive]}>{Number(odds).toFixed(2)}</Text>}
                      </View>
                    );
                  })}
                </View>
                {postedTecken && (
                  <Text style={styles.closedTeckenInfo}>Ditt tecken: {postedTecken}</Text>
                )}
                {!postedTecken && (
                  <Text style={styles.closedNoTecken}>Inget tips registrerat</Text>
                )}
              </View>
            )}

            {status?.antalRatt != null && status.antalRatt > 0 && (
              <View style={styles.closedResultCard}>
                <Text style={styles.closedResultIcon}>🎉</Text>
                <Text style={styles.closedResultLabel}>Senaste resultat</Text>
                <Text style={styles.closedResultValue}>{status.antalRatt} rätt</Text>
              </View>
            )}

            <View style={styles.closedInfoCard}>
              <Text style={styles.closedInfoIcon}>💡</Text>
              <Text style={styles.closedInfoText}>
                Ny omgång öppnar måndag. Följ matchen live under LIVE-fliken!
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Lock overlay */}
        <View style={styles.lockOverlay}>
          <View style={styles.lockCard}>
            <Text style={styles.closedIcon}>🔒</Text>
            <Text style={styles.closedTitle}>Spelet är stängt</Text>
            <Text style={styles.closedText}>Vänta tills nästa kupong publiceras</Text>
          </View>
        </View>

        {renderAnalysisModal()}
      </View>
    );
  }

  // Slutspel: enkelrad (tippa alla 13 matcher) – öppet hela veckan t.o.m. fredag kl 12
  if (status.isSlutspel === 1) {
    const filled = garderingar.length;
    const enkelReady = filled === 13;
    const enkelBarPct = Math.min((filled / 13) * 100, 100);
    const enkelBarColor = enkelReady ? '#1B5E20' : '#F57C00';
    const enkelUnsaved = JSON.stringify(
      [...garderingar].sort((a, b) => a.matchNr - b.matchNr)
    ) !== JSON.stringify(
      [...savedGarderingar.current].sort((a, b) => a.matchNr - b.matchNr)
    );

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.gardHeader}>
          <Text style={styles.gardHeaderIcon}>📝</Text>
          <Text style={styles.gardHeaderTitle}>Tippa enkelrad</Text>
          <Text style={styles.gardHeaderSub}>Omgång {status.spelomgang}</Text>
        </View>

        <View style={[styles.gardCounterCard, enkelReady && styles.gardCounterCardReady]}>
          <View style={styles.gardCounterBar}>
            <View style={[styles.gardCounterFill, { width: `${enkelBarPct}%`, backgroundColor: enkelBarColor }]} />
          </View>
          <Text style={styles.gardCounterText}>{filled} / 13 tecken</Text>
          {!enkelReady && (
            <Text style={[styles.gardStatusMsg, { color: enkelBarColor }]}>
              {13 - filled} match{13 - filled === 1 ? '' : 'er'} kvar
            </Text>
          )}
          {enkelUnsaved && (
            <Text style={styles.gardUnsavedText}>⚠ Ändringar ej sparade</Text>
          )}
        </View>

        <View style={styles.gardCard}>
          {kupong.map((match, matchIdx) => (
            <View key={match.matchNr} style={[styles.gardMatchRow, matchIdx % 2 === 0 && styles.gardMatchRowAlt]}>
              <Text style={styles.gardMatchNr}>{match.matchNr}</Text>
              <TouchableOpacity style={styles.gardMatchInfo} onPress={() => openAnalysis(match)}>
                <Text style={styles.gardMatchLag} numberOfLines={1}>{match.lag}</Text>
                <Text style={styles.gardMatchLiga}>{match.liga}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gardBarIcon} onPress={() => openAnalysis(match)}>
                <View style={[styles.gardBar, { height: 8 }]} />
                <View style={[styles.gardBar, { height: 14 }]} />
                <View style={[styles.gardBar, { height: 11 }]} />
              </TouchableOpacity>
              <View style={styles.gardTeckenRow}>
                {['1', 'X', '2'].map((t) => {
                  const isSelected = garderingar.some(
                    (g) => g.matchNr === parseInt(match.matchNr) && g.tecken === t
                  );
                  const odds = t === '1' ? match.odds1 : t === 'X' ? match.oddsX : match.odds2;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[styles.gardTeckenBtn, isSelected && styles.gardTeckenActive]}
                      onPress={() => handleEnkelradPress(parseInt(match.matchNr), t)}
                    >
                      <Text style={[styles.gardTeckenText, isSelected && styles.gardTeckenTextActive]}>{t}</Text>
                      {odds && (
                        <Text style={[styles.gardOddsText, isSelected && styles.gardOddsTextActive]}>
                          {Number(odds).toFixed(2)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.gardSaveBtn, !enkelReady && styles.gardSaveBtnDisabled]}
          onPress={handleSaveGarderingar}
          disabled={!enkelReady}
        >
          <Text style={[styles.gardSaveBtnText, !enkelReady && styles.gardSaveBtnTextDisabled]}>
            Spara enkelrad
          </Text>
        </TouchableOpacity>

        {renderAnalysisModal()}
      </ScrollView>
    );
  }

  // Tipstecken öppet
  if (status.speletOppet === 1) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.tipsHeader}>
          <Text style={styles.tipsHeaderIcon}>🎯</Text>
          <Text style={styles.tipsHeaderTitle}>Tippa veckans match</Text>
          <Text style={styles.tipsHeaderSub}>Omgång {status.spelomgang}</Text>
        </View>

        {myMatch ? (
          <View style={styles.tipsCard}>
            <View style={styles.tipsLigaBadge}>
              <Text style={styles.tipsLigaText}>{myMatch.liga}</Text>
            </View>
            <TouchableOpacity onPress={() => openAnalysis(myMatch)} style={styles.tipsMatchRow}>
              <Text style={styles.tipsMatchNr}>{myMatch.matchNr}</Text>
              <View style={styles.tipsTeams}>
                <Text style={styles.tipsHomeTeam}>{myMatch.home || myMatch.lag?.split(' - ')[0]}</Text>
                <Text style={styles.tipsVs}>vs</Text>
                <Text style={styles.tipsAwayTeam}>{myMatch.away || myMatch.lag?.split(' - ')[1]}</Text>
              </View>
              <View style={styles.tipsAnalysisIcon}>
                <View style={[styles.tipsBar, { height: 8 }]} />
                <View style={[styles.tipsBar, { height: 14 }]} />
                <View style={[styles.tipsBar, { height: 11 }]} />
              </View>
            </TouchableOpacity>

            <Text style={styles.tipsLabel}>Välj ditt tecken</Text>
            <View style={styles.tipsTeckenRow}>
              {['1', 'X', '2'].map((t) => {
                const odds = t === '1' ? myMatch.odds1 : t === 'X' ? myMatch.oddsX : myMatch.odds2;
                const isSelected = selectedTecken === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.tipsTeckenButton, isSelected && styles.tipsTeckenActive]}
                    onPress={() => handleTeckenPress(t)}
                  >
                    <Text style={[styles.tipsTeckenText, isSelected && styles.tipsTeckenTextActive]}>{t}</Text>
                    {odds && (
                      <Text style={[styles.tipsOddsText, isSelected && styles.tipsOddsTextActive]}>
                        {Number(odds).toFixed(2)}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedTecken && (
              <View style={styles.tipsSavedBadge}>
                <Text style={styles.tipsSavedText}>✓ Sparat</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.tipsCard}>
            <Text style={styles.noMatchText}>Ingen match tilldelad denna omgång.</Text>
          </View>
        )}

        {renderAnalysisModal()}

        <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      </ScrollView>
    );
  }

  // Garderingar öppet
  const hasUnsavedChanges = JSON.stringify(
    [...garderingar].sort((a, b) => a.matchNr - b.matchNr || a.tecken.localeCompare(b.tecken))
  ) !== JSON.stringify(
    [...savedGarderingar.current].sort((a, b) => a.matchNr - b.matchNr || a.tecken.localeCompare(b.tecken))
  );
  const gardDiff = garderingar.length - maxGarderingar;
  const gardReady = gardDiff === 0;
  const gardRemaining = Math.abs(gardDiff);
  const gardBarPct = Math.min((garderingar.length / maxGarderingar) * 100, 100);
  const gardBarColor = gardReady ? '#1B5E20' : gardDiff < 0 ? '#F57C00' : '#D32F2F';
  const gardLabel = status.isSlutspel === 1 ? 'tecken' : 'garderingar';
  const gardLabelSingular = status.isSlutspel === 1 ? 'tecken' : 'gardering';
  const gardStatusMsg = gardReady
    ? ''
    : gardDiff < 0
      ? `${gardRemaining} ${gardRemaining === 1 ? gardLabelSingular : gardLabel} kvar`
      : `${gardRemaining} för mycket`;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 80 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.gardHeader}>
        <Text style={styles.gardHeaderIcon}>{status.isSlutspel === 1 ? '📝' : '🃏'}</Text>
        <Text style={styles.gardHeaderTitle}>
          {status.isSlutspel === 1 ? 'Tippa enkelrad' : 'Tippa garderingar'}
        </Text>
        <Text style={styles.gardHeaderSub}>Omgång {status.spelomgang}</Text>
      </View>

      <View style={[styles.gardCounterCard, gardReady && styles.gardCounterCardReady]}>
        <View style={styles.gardCounterBar}>
          <View style={[styles.gardCounterFill, { width: `${gardBarPct}%`, backgroundColor: gardBarColor }]} />
        </View>
        <Text style={styles.gardCounterText}>
          {garderingar.length} / {maxGarderingar} {gardLabel}
        </Text>
        <Text style={[styles.gardStatusMsg, { color: gardBarColor }]}>
          {gardStatusMsg}
        </Text>
        {hasUnsavedChanges && (
          <Text style={styles.gardUnsavedText}>⚠ Ändringar ej sparade</Text>
        )}
      </View>

      <View style={styles.gardCard}>
        {kupong.map((match, matchIdx) => {
          let grundtecken = Number(match.etta) === 1 ? '1' : Number(match.kryss) === 1 ? 'X' : Number(match.tvaa) === 1 ? '2' : null;
          if (!grundtecken && match.odds1 && match.oddsX && match.odds2) {
            const o1 = Number(match.odds1), oX = Number(match.oddsX), o2 = Number(match.odds2);
            if (!(o1 === 1 && oX === 1 && o2 === 1)) {
              const min = Math.min(o1, oX, o2);
              grundtecken = min === o1 ? '1' : min === oX ? 'X' : '2';
            }
          }

          return (
            <View key={match.matchNr} style={[styles.gardMatchRow, matchIdx % 2 === 0 && styles.gardMatchRowAlt]}>
              <Text style={styles.gardMatchNr}>{match.matchNr}</Text>
              <TouchableOpacity style={styles.gardMatchInfo} onPress={() => openAnalysis(match)}>
                <Text style={styles.gardMatchLag} numberOfLines={1}>{match.lag}</Text>
                <Text style={styles.gardMatchLiga}>{match.liga}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.gardBarIcon} onPress={() => openAnalysis(match)}>
                <View style={[styles.gardBar, { height: 8 }]} />
                <View style={[styles.gardBar, { height: 14 }]} />
                <View style={[styles.gardBar, { height: 11 }]} />
              </TouchableOpacity>
              <View style={styles.gardTeckenRow}>
                {['1', 'X', '2'].map((t) => {
                  const isGrundtecken = t === grundtecken;
                  const isGardering = garderingar.some(
                    (g) => g.matchNr === parseInt(match.matchNr) && g.tecken === t
                  );
                  const odds = t === '1' ? match.odds1 : t === 'X' ? match.oddsX : match.odds2;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.gardTeckenBtn,
                        isGrundtecken && styles.gardTeckenLocked,
                        isGardering && styles.gardTeckenActive,
                      ]}
                      onPress={() => !isGrundtecken && handleGarderingPress(parseInt(match.matchNr), t)}
                      disabled={isGrundtecken}
                    >
                      <Text style={[
                        styles.gardTeckenText,
                        isGrundtecken && styles.gardTeckenTextLocked,
                        isGardering && styles.gardTeckenTextActive,
                      ]}>{t}</Text>
                      {odds && (
                        <Text style={[
                          styles.gardOddsText,
                          isGardering && styles.gardOddsTextActive,
                        ]}>{Number(odds).toFixed(2)}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      <View style={[styles.gardCounterCard, gardReady && styles.gardCounterCardReady]}>
        <View style={styles.gardCounterBar}>
          <View style={[styles.gardCounterFill, { width: `${gardBarPct}%`, backgroundColor: gardBarColor }]} />
        </View>
        <Text style={styles.gardCounterText}>
          {garderingar.length} / {maxGarderingar} {gardLabel}
        </Text>
        <Text style={[styles.gardStatusMsg, { color: gardBarColor }]}>
          {gardStatusMsg}
        </Text>
        {hasUnsavedChanges && (
          <Text style={styles.gardUnsavedText}>⚠ Ändringar ej sparade</Text>
        )}
      </View>

      <TouchableOpacity
        style={[styles.gardSaveBtn, !gardReady && styles.gardSaveBtnDisabled]}
        onPress={handleSaveGarderingar}
        disabled={!gardReady}
      >
        <Text style={[styles.gardSaveBtnText, !gardReady && styles.gardSaveBtnTextDisabled]}>
          {status.isSlutspel === 1 ? 'Spara enkelrad' : 'Spara garderingar'}
        </Text>
      </TouchableOpacity>

      {renderAnalysisModal()}
    </ScrollView>
  );
}

function PasswordModal({
  visible,
  password,
  onChangePassword,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  password: string;
  onChangePassword: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Bekräfta med lösenord</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="Lösenord"
            secureTextEntry
            value={password}
            onChangeText={onChangePassword}
            autoCapitalize="none"
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.modalCancelButton} onPress={onCancel}>
              <Text style={styles.modalCancelText}>Avbryt</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalConfirmButton} onPress={onConfirm}>
              <Text style={styles.modalConfirmText}>Spara</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 16,
  },
  // Tips open styles
  tipsHeader: {
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 8,
  },
  tipsHeaderIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  tipsHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1B5E20',
  },
  tipsHeaderSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  tipsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  tipsLigaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8F5E9',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  tipsLigaText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2E7D32',
  },
  tipsMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  tipsMatchNr: {
    fontSize: 28,
    fontWeight: '800',
    color: '#C8E6C9',
    marginRight: 14,
  },
  tipsTeams: {
    flex: 1,
  },
  tipsHomeTeam: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
  },
  tipsVs: {
    fontSize: 11,
    color: '#aaa',
    marginVertical: 2,
  },
  tipsAwayTeam: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
  },
  tipsAnalysisIcon: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginLeft: 10,
  },
  tipsBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: '#1B5E20',
  },
  tipsLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
  },
  tipsTeckenRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  tipsTeckenButton: {
    width: 72,
    height: 72,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  tipsTeckenActive: {
    backgroundColor: '#1B5E20',
    borderColor: '#1B5E20',
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  tipsTeckenText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#555',
  },
  tipsTeckenTextActive: {
    color: '#fff',
  },
  tipsOddsText: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  tipsOddsTextActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  tipsSavedBadge: {
    alignSelf: 'center',
    backgroundColor: '#E8F5E9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  tipsSavedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2E7D32',
  },
  // Gardering styles
  gardHeader: {
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 8,
  },
  gardHeaderIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  gardHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1B5E20',
  },
  gardHeaderSub: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  gardCounterCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  gardCounterBar: {
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    marginBottom: 8,
    overflow: 'hidden',
  },
  gardCounterFill: {
    height: '100%',
    backgroundColor: '#1B5E20',
    borderRadius: 3,
  },
  gardCounterText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
  },
  gardCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  gardMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  gardMatchRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  gardMatchNr: {
    fontSize: 14,
    fontWeight: '800',
    color: '#C8E6C9',
    width: 22,
  },
  gardMatchInfo: {
    flex: 1,
    marginRight: 8,
  },
  gardMatchLag: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1B5E20',
  },
  gardMatchLiga: {
    fontSize: 11,
    color: '#999',
  },
  gardTeckenRow: {
    flexDirection: 'row',
    gap: 6,
  },
  gardBarIcon: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    marginRight: 10,
    paddingVertical: 4,
  },
  gardBar: {
    width: 3.5,
    borderRadius: 2,
    backgroundColor: '#1B5E20',
  },
  gardTeckenBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  gardTeckenLocked: {
    backgroundColor: '#E8F5E9',
    borderColor: '#66BB6A',
  },
  gardTeckenActive: {
    backgroundColor: '#1B5E20',
    borderColor: '#1B5E20',
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  gardTeckenText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#555',
  },
  gardTeckenTextLocked: {
    color: '#2E7D32',
  },
  gardTeckenTextActive: {
    color: '#fff',
  },
  gardOddsText: {
    fontSize: 9,
    color: '#999',
    marginTop: 1,
  },
  gardOddsTextActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  gardSaveBtn: {
    backgroundColor: '#1B5E20',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#1B5E20',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  gardSaveBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  gardSaveBtnDisabled: {
    backgroundColor: '#BDBDBD',
    shadowOpacity: 0,
    elevation: 0,
  },
  gardSaveBtnTextDisabled: {
    color: 'rgba(255,255,255,0.7)',
  },
  gardStatusMsg: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
  },
  gardCounterCardReady: {
    borderColor: '#1B5E20',
    borderWidth: 1.5,
  },
  gardUnsavedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F57C00',
    textAlign: 'center',
    marginTop: 6,
  },
  centeredContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  welcome: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1B5E20',
    marginBottom: 16,
  },
  positionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderLeftWidth: 4,
    borderLeftColor: '#1B5E20',
  },
  positionIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  positionLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  positionValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B5E20',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
  },
  liga: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  matchText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
    marginBottom: 16,
  },
  noMatchText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  postedInfo: {
    fontSize: 14,
    color: '#1B5E20',
    fontWeight: '600',
    marginTop: -8,
  },
  teckenRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  teckenButton: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  teckenButtonActive: {
    backgroundColor: '#F9A825',
    borderColor: '#F57F17',
  },
  teckenButtonDisabledActive: {
    backgroundColor: '#1B5E20',
    borderColor: '#1B5E20',
    opacity: 0.8,
  },
  teckenButtonDisabled: {
    backgroundColor: '#f0f0f0',
    borderColor: '#e0e0e0',
    opacity: 0.5,
  },
  teckenButtonLocked: {
    backgroundColor: '#FFCC80',
    borderColor: '#FFB74D',
  },
  grundLabel: {
    fontSize: 7,
    color: '#795548',
    fontWeight: '700',
    position: 'absolute',
    top: 2,
  },
  teckenText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#555',
  },
  teckenTextActive: {
    color: '#fff',
  },
  teckenTextDisabled: {
    color: '#bbb',
  },
  oddsText: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  oddsTextSmall: {
    fontSize: 9,
    color: '#888',
    marginTop: 1,
  },
  oddsTextActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  teckenButtonSmall: {
    width: 36,
    height: 36,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  teckenTextSmall: {
    fontSize: 14,
    fontWeight: '700',
    color: '#555',
  },
  saveButton: {
    backgroundColor: '#1B5E20',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  closedBackground: {
    paddingTop: 8,
    opacity: 0.4,
  },
  closedOmgang: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  closedMatchCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  closedMatchLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  closedMatchLiga: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  closedMatchLag: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B5E20',
    textDecorationLine: 'underline',
    marginBottom: 14,
    textAlign: 'center',
  },
  closedTeckenRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  closedTeckenButton: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafafa',
  },
  closedTeckenActive: {
    backgroundColor: '#1B5E20',
    borderColor: '#1B5E20',
  },
  closedTeckenText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#999',
  },
  closedTeckenTextActive: {
    color: '#fff',
  },
  closedOddsText: {
    fontSize: 10,
    color: '#aaa',
    marginTop: 1,
  },
  closedOddsTextActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  closedTeckenInfo: {
    fontSize: 13,
    color: '#1B5E20',
    fontWeight: '600',
  },
  closedNoTecken: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
  closedResultCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  closedResultIcon: {
    fontSize: 32,
    marginBottom: 6,
  },
  closedResultLabel: {
    fontSize: 12,
    color: '#888',
    fontWeight: '500',
    marginBottom: 2,
  },
  closedResultValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1B5E20',
  },
  closedInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  closedInfoIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  closedInfoText: {
    flex: 1,
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  lockCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 36,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
    width: '100%',
  },
  closedCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  closedIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  closedTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  closedText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  matchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  matchNr: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    width: 24,
  },
  matchNames: {
    flex: 1,
  },
  matchLag: {
    fontSize: 13,
    fontWeight: '600',
    color: '#222',
  },
  matchLiga: {
    fontSize: 11,
    color: '#999',
  },
  garderingInfo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    width: '85%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    color: '#333',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelButton: {
    padding: 12,
  },
  modalCancelText: {
    fontSize: 16,
    color: '#666',
  },
  modalConfirmButton: {
    backgroundColor: '#1B5E20',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  modalConfirmText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  analysisOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  analysisContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
  },
  analysisCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 380,
    maxHeight: '90%',
  },
  analysisHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  analysisScroll: {
    flexShrink: 1,
  },
  analysisCloseX: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  analysisCloseXText: { fontSize: 15, color: '#666', fontWeight: '700' },
  analysisTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
  },
  analysisLeague: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginBottom: 16,
  },
  analysisTeams: {
    gap: 12,
    marginBottom: 20,
  },
  analysisTeamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    padding: 12,
  },
  teamLogo: {
    width: 36,
    height: 36,
    borderRadius: 4,
    marginRight: 12,
  },
  analysisTeamInfo: {
    flex: 1,
  },
  analysisCardChevron: {
    fontSize: 22,
    color: '#BBB',
    marginLeft: 8,
    fontWeight: '700',
  },
  analysisPositionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  analysisPosition: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1B5E20',
  },
  analysisTeamName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  formRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  formBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  formWin: {
    backgroundColor: '#1B5E20',
  },
  formDraw: {
    backgroundColor: '#F57F17',
  },
  formLoss: {
    backgroundColor: '#C62828',
  },
  formBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  // Formdetaljer-popup
  formModalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  formModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    width: '100%',
    maxWidth: 360,
  },
  formModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formModalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#1B5E20',
  },
  formModalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formModalCloseText: { fontSize: 15, color: '#666', fontWeight: '700' },
  formModalSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
    marginBottom: 10,
  },
  formDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EEE',
  },
  formDetailDate: {
    width: 52,
    fontSize: 12,
    color: '#777',
  },
  formDetailHA: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  formDetailHome: { backgroundColor: '#E3F2E5' },
  formDetailAway: { backgroundColor: '#EDE7F6' },
  formDetailHAText: { fontSize: 11, fontWeight: '800', color: '#444' },
  formDetailOpp: { flex: 1, fontSize: 14, color: '#333' },
  formDetailScore: { fontSize: 14, fontWeight: '700', color: '#222', marginHorizontal: 8, minWidth: 34, textAlign: 'center' },
  formDetailBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  analysisNoData: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
  standingsTable: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    overflow: 'hidden',
  },
  standingsHeader: {
    flexDirection: 'row',
    backgroundColor: '#1B5E20',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  standingsHeaderText: {
    color: '#fff',
    fontWeight: '700',
  },
  standingsRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0e0e0',
  },
  standingsHighlight: {
    backgroundColor: '#C8E6C9',
  },
  standingsHighlightText: {
    fontWeight: '700',
  },
  standingsCell: {
    fontSize: 11,
    color: '#333',
  },
  standingsPosCol: {
    width: 20,
    textAlign: 'center',
  },
  standingsTeamCol: {
    flex: 1,
    paddingHorizontal: 4,
  },
  standingsNumCol: {
    width: 22,
    textAlign: 'center',
  },
  standingsGoalCol: {
    width: 38,
    textAlign: 'center',
  },
  closeAnalysisBtn: {
    marginTop: 14,
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  closeAnalysisBtnText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '600',
  },
  aiSection: {
    marginTop: 16,
    marginBottom: 8,
  },
  aiBtn: {
    backgroundColor: '#6A1B9A',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  aiBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  aiErrorBox: {
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#E65100',
  },
  aiErrorText: {
    color: '#E65100',
    fontSize: 13,
  },
  aiResultBox: {
    backgroundColor: '#F3E5F5',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#6A1B9A',
  },
  aiResultLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6A1B9A',
    marginBottom: 6,
  },
  aiResultText: {
    fontSize: 13,
    color: '#333',
    lineHeight: 20,
  },
  toast: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#1B5E20',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
