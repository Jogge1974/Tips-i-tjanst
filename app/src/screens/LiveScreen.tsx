import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Image,
} from 'react-native';
import { api } from '../services/api';
import { Ionicons } from '@expo/vector-icons';

const API_BASE_URL = 'https://tipsitjanst-api.azurewebsites.net/api/api';

interface LiveEvent {
  eventNumber: number;
  description: string;
  home: string;
  away: string;
  league: string;
  sportEventStart: string;
  sportEventStatus: string;
  isFinished: boolean;
  cancelled: boolean;
  outcomes: { home: string; draw: string; away: string } | null;
  odds: { home: string; draw: string; away: string };
}

interface LiveDraw {
  drawNumber: number;
  drawComment?: string;
  drawState: string;
  closeTime: string;
  turnover: string;
  distribution?: { winners: number; amount: string; name: string; sign?: string; eventNumber?: string }[];
  events: LiveEvent[];
}

interface SystemRow {
  radNr: number;
  m1: string; m2: string; m3: string; m4: string; m5: string;
  m6: string; m7: string; m8: string; m9: string; m10: string;
  m11: string; m12: string; m13: string;
}

function getResultSign(event: LiveEvent): string {
  if (!event.outcomes) return 'X'; // Ej startat = 0-0 = kryss
  const homeGoals = parseInt(event.outcomes.home) || 0;
  const awayGoals = parseInt(event.outcomes.away) || 0;
  if (homeGoals > awayGoals) return '1';
  if (homeGoals < awayGoals) return '2';
  return 'X';
}

function getScore(event: LiveEvent): string {
  if (!event.outcomes) return '0-0';
  return `${event.outcomes.home}-${event.outcomes.away}`;
}

function formatTime(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  const days = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
  return days[date.getDay()];
}

function calculateCorrect(row: SystemRow, events: LiveEvent[]): number {
  let correct = 0;
  for (let i = 1; i <= 13; i++) {
    const event = events[i - 1];
    if (!event) continue;
    const resultSign = getResultSign(event);
    const rowSign = (row as any)[`m${i}`];
    if (rowSign === resultSign) correct++;
  }
  return correct;
}

function getEventStatusColor(status: string): string {
  if (status === 'Inte startat') return '#999';
  if (status === 'Avslutad' || status === 'Slut' || status.startsWith('Slut')) return '#1B5E20';
  return '#E65100'; // Pågående
}

export default function LiveScreen() {
  const [draw, setDraw] = useState<LiveDraw | null>(null);
  const [rows, setRows] = useState<SystemRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'kupong' | 'rader'>('kupong');
  const [changedEvents, setChangedEvents] = useState<Record<number, number>>({}); // eventNumber -> timestamp
  const prevScoresRef = useRef<Record<number, string>>({});
  const [analysisModal, setAnalysisModal] = useState<{
    visible: boolean;
    home: any;
    away: any;
    standings: any[];
    league: string;
    eventHome: string;
    eventAway: string;
    eventNumber: number | null;
    startTime: string;
    loading: boolean;
  }>({ visible: false, home: null, away: null, standings: [], league: '', eventHome: '', eventAway: '', eventNumber: null, startTime: '', loading: false });

  const [selectedRowIdx, setSelectedRowIdx] = useState(0);
  const [garderingTable, setGarderingTable] = useState<{ isSlutspel: number; spelomgang: string; table: { userId: number; namn: string; ratt: number | null; position: number | null }[] } | null>(null);
  const [grundtipsen, setGrundtipsen] = useState<{ matchNr: number; ansvarig: string; tecken: string | null; isCorrect: boolean | null; isSTMF: boolean; odds: number; score: string | null; status: string; isFinished: boolean; cancelled: boolean; sportEventStart: string }[] | null>(null);
  const [utdelningExpanded, setUtdelningExpanded] = useState(false);
  const [garderingExpanded, setGarderingExpanded] = useState(false);
  const [grundtipsenExpanded, setGrundtipsenExpanded] = useState(false);
  const [mallista, setMallista] = useState<{ eventNumber: number; home: string; away: string; fromScore: string; toScore: string; detectedAtMs: number }[]>([]);
  const [malrapportExpanded, setMalrapportExpanded] = useState(true);
  // Valt utfall (tecken) för "Utdelning vid olika utfall" när en match återstår.
  // null = följ matchens aktuella liveresultat.
  const [selectedDistSign, setSelectedDistSign] = useState<string | null>(null);
  const [kupongModal, setKupongModal] = useState<{
    spelomgang: string;
    isSlutspel: number;
    matches: { matchNr: number; lag: string; rtecken: string | null }[];
    users: { userId: number; namn: string; ratt: number; tecken: Record<string, { t: string | null; c: boolean | null }> }[];
  } | null>(null);
  const [kupongLoading, setKupongLoading] = useState(false);

  const openAnalysis = (event: LiveEvent) => {
    // Live-vyn visar bara match-/målinfo, ingen form/tabell
    setAnalysisModal({ visible: true, home: null, away: null, standings: [], league: event.league || '', eventHome: event.home, eventAway: event.away, eventNumber: event.eventNumber, startTime: event.sportEventStart || '', loading: false });
  };

  const openKupong = async () => {
    if (!garderingTable?.spelomgang) return;
    setKupongLoading(true);
    try {
      const data = await api.getAllGarderingar(garderingTable.spelomgang);
      setKupongModal(data);
    } catch (e) {
      console.error('Failed to load garderingar:', e);
    } finally {
      setKupongLoading(false);
    }
  };

  const loadData = useCallback(async () => {
    try {
      const drawData = await api.getLiveDraw();
      
      // Detect score changes
      if (drawData?.events) {
        const now = Date.now();
        const newChanges: Record<number, number> = {};
        for (const event of drawData.events) {
          const score = event.outcomes ? `${event.outcomes.home}-${event.outcomes.away}` : null;
          const prevScore = prevScoresRef.current[event.eventNumber];
          if (score && prevScore !== undefined && prevScore !== score) {
            newChanges[event.eventNumber] = now;
          }
          if (score) {
            prevScoresRef.current[event.eventNumber] = score;
          }
        }
        if (Object.keys(newChanges).length > 0) {
          setChangedEvents(prev => ({ ...prev, ...newChanges }));
        }
      }

      setDraw(drawData);

      if (drawData?.drawNumber) {
        const rowsData = await api.getSystemRows(drawData.drawNumber);
        setRows(rowsData);
      }

      // Fetch gardering table
      try {
        const gardData = await api.getLiveGarderingTable();
        setGarderingTable(gardData);
      } catch (e) { /* ignore */ }

      // Fetch grundtipsen
      try {
        const grundData = await api.getGrundtipsen();
        setGrundtipsen(grundData);
      } catch (e) { /* ignore */ }

      // Fetch målrapport
      try {
        const malData = await api.getMallista();
        setMallista(malData);
      } catch (e) { /* ignore */ }
    } catch (error: any) {
      console.error('Live error:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
      const interval = setInterval(loadData, 15000);
      return () => clearInterval(interval);
    }, [loadData])
  );

  // Rensa ändrade event-markeringar efter 2 minuter
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      setChangedEvents(prev => {
        const filtered: Record<number, number> = {};
        for (const [key, ts] of Object.entries(prev)) {
          if (now - ts < 120000) filtered[Number(key)] = ts;
        }
        return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered;
      });
    }, 5000);
    return () => clearInterval(cleanup);
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1B5E20" />
      </View>
    );
  }

  if (!draw || !draw.events || draw.events.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={styles.centeredContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.noDataText}>Ingen aktiv stryktipsetomgång just nu.</Text>
        <Text style={styles.noDataSubtext}>Dra ner för att uppdatera.</Text>
      </ScrollView>
    );
  }

  // Beräkna antal rätt per rad
  const rowResults = rows.map((row) => ({
    ...row,
    correct: calculateCorrect(row, draw.events),
  }));

  // Sortera på antal rätt (högst först)
  const sortedRows = [...rowResults].sort((a, b) => b.correct - a.correct);

  // Räkna antal slutförda matcher
  const finishedEvents = draw.events.filter(
    (e) => e.isFinished || e.cancelled
  ).length;

  // Bästa rad
  const bestRow = sortedRows[0];

  // Sammanställning: hur många rader per antal rätt
  const rightCount: Record<number, number> = {};
  for (const r of rowResults) {
    rightCount[r.correct] = (rightCount[r.correct] || 0) + 1;
  }

  // Välj rätt distributionspost för en vinstgrupp. När en match är oavgjord
  // publicerar Svenska Spel tre varianter (tecken 1/X/2) för den kvarvarande
  // matchen. Vi väljer den variant som matchar matchens nuvarande liveresultat
  // (ej startad = 0-0 = X), samma antagande som antal rätt beräknas med.
  // signOverride låter oss visa utdelning för ett annat hypotetiskt utfall.
  const getDistEntry = (numRight: number, signOverride?: string | null) => {
    if (!draw?.distribution) return undefined;
    const entries = draw.distribution.filter((d) => {
      const m = d.name.match(/(\d+)/);
      return m && parseInt(m[1]) === numRight;
    });
    if (entries.length === 0) return undefined;
    if (entries.length === 1) return entries[0];
    // Flera teckenvarianter: välj den som matchar valt/aktuellt tecken
    const splitEventNr = entries[0].eventNumber ? parseInt(entries[0].eventNumber) : null;
    let sign = signOverride ?? null;
    if (!sign && splitEventNr) {
      const ev = draw.events.find((e) => e.eventNumber === splitEventNr);
      if (ev) sign = getResultSign(ev);
    }
    if (sign) {
      const matched = entries.find((e) => e.sign === sign);
      if (matched) return matched;
    }
    return entries[0];
  };

  // Upptäck om distributionen är uppdelad på en kvarvarande, oavgjord match
  // (flera teckenvarianter per vinstgrupp). Returnerar matchen, tillgängliga
  // tecken och det tecken som gäller just nu.
  const getDistSplit = () => {
    if (!draw?.distribution) return null;
    const byTier: Record<number, typeof draw.distribution> = {};
    for (const d of draw.distribution) {
      const m = d.name.match(/(\d+)/);
      if (!m) continue;
      const n = parseInt(m[1]);
      (byTier[n] ||= []).push(d);
    }
    for (const key of Object.keys(byTier)) {
      const entries = byTier[Number(key)];
      if (entries.length > 1 && entries[0].eventNumber) {
        const evNr = parseInt(entries[0].eventNumber);
        const ev = draw.events.find((e) => e.eventNumber === evNr);
        if (ev) {
          const signs = Array.from(
            new Set(entries.map((e) => e.sign).filter(Boolean))
          ) as string[];
          return { event: ev, signs, currentSign: getResultSign(ev) };
        }
      }
    }
    return null;
  };

  const distSplit = getDistSplit();
  // Tecknet som utdelningstabellen visar: användarens val, annars aktuellt utfall
  const effectiveDistSign = distSplit
    ? selectedDistSign ?? distSplit.currentSign
    : null;

  // Beräkna vinst från distribution
  const calculateWinnings = (): number => {
    if (!draw?.distribution || !rows.length) return 0;
    let total = 0;
    for (const numRight of [13, 12, 11, 10]) {
      const count = rightCount[numRight] || 0;
      if (count <= 0) continue;
      const dist = getDistEntry(numRight);
      if (!dist) continue;
      // Parse "2910526,00" -> 2910526
      const amount = parseFloat(dist.amount.replace(',', '.'));
      total += count * amount;
    }
    return Math.round(total);
  };

  const winnings = calculateWinnings();

  // Check if any match has started
  const startedEvents = draw.events.filter(e => e.sportEventStatus !== 'Inte startat');
  const noneStarted = startedEvents.length === 0;

  // System description (hel/halv/garanti)
  const getSystemDescription = (): string => {
    if (!rows.length) return '';
    let hel = 0, halv = 0;
    const signCounts: number[] = [];
    for (let i = 1; i <= 13; i++) {
      const signs = new Set(rows.map(r => (r as any)[`m${i}`]));
      signCounts.push(signs.size);
      if (signs.size === 3) hel++;
      else if (signs.size === 2) halv++;
    }

    // Replicate smartReduce group logic
    const variablePositions = signCounts
      .map((cnt, idx) => ({ idx, cnt }))
      .filter(x => x.cnt > 1)
      .sort((a, b) => b.cnt - a.cnt);

    let garanti = 13;
    if (variablePositions.length > 0) {
      let variabelMat = 1;
      for (const v of variablePositions) variabelMat *= v.cnt;

      if (variabelMat <= 243) {
        garanti = 12;
      } else {
        let antalGrupper = 4;
        for (let tryGroups = 2; tryGroups <= 4; tryGroups++) {
          const testGroupMat = new Array(tryGroups).fill(1);
          for (let i = 0; i < variablePositions.length; i++)
            testGroupMat[i % tryGroups] *= variablePositions[i].cnt;
          if (testGroupMat.every(m => m <= 243)) {
            antalGrupper = tryGroups;
            break;
          }
        }
        garanti = 13 - antalGrupper;
      }
    }

    return `${hel} hel – ${halv} halv – ${rows.length} rader (${garanti}-rättsgaranti)`;
  };

  const systemDesc = getSystemDescription();

  // Countdown to first match
  const getFirstMatchCountdown = (): string => {
    if (!noneStarted) return '';
    const starts = draw.events
      .map(e => new Date(e.sportEventStart).getTime())
      .filter(t => t > Date.now())
      .sort((a, b) => a - b);
    if (!starts.length) return '';
    const diff = starts[0] - Date.now();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remH = hours % 24;
      return `${days}d ${remH}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes} min`;
  };

  const firstMatchCountdown = getFirstMatchCountdown();

  // Parse distribution amounts for display
  const getDistAmount = (numRight: number): string => {
    const dist = getDistEntry(numRight, effectiveDistSign);
    if (!dist) return '-';
    const amount = parseFloat(dist.amount.replace(',', '.'));
    return Math.round(amount).toLocaleString('sv-SE');
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Kompakt header - klickbar för expand */}
      {rows.length > 0 && !noneStarted && (
        <TouchableOpacity
          style={styles.headerRow}
          onPress={() => setHeaderExpanded(!headerExpanded)}
          activeOpacity={0.8}
        >
          <View style={styles.headerCol}>
            <Text style={styles.headerLabel}>Bästa rad</Text>
            <Text style={styles.headerBig}>{bestRow ? `${bestRow.correct} rätt` : '-'}</Text>
          </View>
          <View style={[styles.headerCol, { alignItems: 'flex-end' }]}>
            <Text style={styles.headerLabel}>Din vinst just nu</Text>
            <Text style={styles.headerBig}>{winnings.toLocaleString('sv-SE')} kr</Text>
          </View>
          {headerExpanded && (
            <View style={styles.headerExpanded}>
              <Text style={styles.headerExpandedText}>
                {draw.drawComment || `Omgång ${draw.drawNumber}`}
              </Text>
              <Text style={styles.headerExpandedText}>
                {rows.length} rader · {finishedEvents}/13 avgjorda
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Waiting hero - before matches start */}
      {noneStarted && (
        <View style={styles.waitingHero}>
          <Text style={styles.waitingHeroEmoji}>⚽</Text>
          <Text style={styles.waitingHeroTitle}>
            {draw.drawComment || `Omgång ${draw.drawNumber}`}
          </Text>
          {firstMatchCountdown ? (
            <View style={styles.countdownRow}>
              <Text style={styles.countdownLabel}>Första match om</Text>
              <Text style={styles.countdownValue}>{firstMatchCountdown}</Text>
            </View>
          ) : (
            <Text style={styles.waitingHeroSub}>Matchstart snart!</Text>
          )}
          {rows.length > 0 && (
            <View style={styles.startingRattRow}>
              <Text style={styles.startingRattLabel}>Startar med</Text>
              <Text style={styles.startingRattValue}>{bestRow ? bestRow.correct : 0} rätt</Text>
              <Text style={styles.startingRattSub}>(alla matcher 0-0 = X)</Text>
            </View>
          )}
          {rows.length > 0 && (
            <Text style={styles.systemDescText}>{systemDesc}</Text>
          )}
        </View>
      )}

      {/* Tabb-väljare - visa bara om vi har rader och matches live */}
      {rows.length > 0 && !noneStarted ? (
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'kupong' && styles.tabActive]}
          onPress={() => setActiveTab('kupong')}
        >
          <Text style={[styles.tabText, activeTab === 'kupong' && styles.tabTextActive]}>Min kupong</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'rader' && styles.tabActive]}
          onPress={() => setActiveTab('rader')}
        >
          <Text style={[styles.tabText, activeTab === 'rader' && styles.tabTextActive]}>Bästa enkelrad</Text>
        </TouchableOpacity>
      </View>
      ) : !noneStarted ? (
        <View style={styles.upcomingHeader}>
          <Text style={styles.upcomingTitle}>{draw.drawComment || `Omgång ${draw.drawNumber}`}</Text>
          <Text style={styles.upcomingSubtitle}>Veckans kupong</Text>
        </View>
      ) : (
        <View style={styles.upcomingHeader}>
          <Text style={styles.upcomingTitle}>Veckans kupong</Text>
        </View>
      )}

      {/* Tab: Min kupong */}
      {(activeTab === 'kupong' || rows.length === 0) && (
        <View style={styles.card}>
          {draw.events.map((event, idx) => {
            const sign = getResultSign(event);
            const score = getScore(event);
            const coveredSigns = new Set<string>();
            for (const row of rows) {
              coveredSigns.add((row as any)[`m${idx + 1}`]);
            }
            const hasCovered = rows.length > 0;
            const weCoveredResult = hasCovered && coveredSigns.has(sign);
            const isStarted = event.sportEventStatus !== 'Inte startat';
            const isFinished = event.isFinished || event.cancelled;

            const hasRecentGoal = !!changedEvents[event.eventNumber];

            return (
              <View key={event.eventNumber} style={[
                styles.eventRow,
                isStarted && !isFinished && styles.eventRowLive,
                isFinished && styles.eventRowFinished,
              ]}>
                <Text style={styles.eventNr}>{event.eventNumber}</Text>
                <TouchableOpacity style={styles.eventInfo} onPress={() => openAnalysis(event)}>
                  <Text style={styles.eventTeams} numberOfLines={1}>
                    {event.home} - {event.away}
                  </Text>
                  {event.league ? <Text style={styles.eventLeague}>{event.league}</Text> : null}
                </TouchableOpacity>

                <View style={styles.eventResultArea}>
                  {!isStarted ? (
                    <Text style={styles.eventTimeText}>{formatTime(event.sportEventStart)}</Text>
                  ) : (
                    <View style={styles.scoreArea}>
                      {hasRecentGoal ? (
                        <Text style={styles.goalIcon}>⚽</Text>
                      ) : isFinished ? (
                        <Text style={styles.ftPrefix}>FT</Text>
                      ) : (
                        <Text style={styles.eventTimeStarted}>{formatTime(event.sportEventStart)}</Text>
                      )}
                      <View style={[
                        styles.scoreBadge,
                        weCoveredResult ? styles.scoreBadgeCovered : styles.scoreBadgeNotCovered,
                        isFinished && { backgroundColor: '#fff' },
                      ]}>
                        <Text style={[styles.scoreBadgeText, weCoveredResult ? styles.scoreBadgeTextCovered : styles.scoreBadgeTextNotCovered]}>{score}</Text>
                      </View>
                    </View>
                  )}
                </View>

                {hasCovered && (
                  <View style={styles.signsContainer}>
                    {['1', 'X', '2'].map(s => {
                      const isCovered = coveredSigns.has(s);
                      const isCurrent = s === sign;
                      let borderColor = 'transparent';
                      if (isCurrent) {
                        borderColor = isCovered ? '#1B5E20' : '#C62828';
                      }
                      return (
                        <View
                          key={s}
                          style={[
                            styles.signBox,
                            isCovered ? styles.signBoxCovered : styles.signBoxUncovered,
                            isCurrent && { borderWidth: 2.5, borderColor },
                          ]}
                        >
                          <Text style={[
                            styles.signBoxText,
                            isCovered ? styles.signBoxTextCovered : styles.signBoxTextUncovered,
                          ]}>{s}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
                {!hasCovered && (
                  <View style={styles.signsContainer}>
                    {['1', 'X', '2'].map(s => (
                      <View key={s} style={[styles.signBox, styles.signBoxNeutral]}>
                        <Text style={[styles.signBoxText, styles.signBoxTextNeutral]}>{s}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Tab: Bästa enkelrad */}
      {activeTab === 'rader' && sortedRows.length > 0 && (
        <View style={styles.card}>
          <View style={styles.enkelradContainer}>
            {/* Fast vänsterdel: matchinfo + resultat */}
            <View style={styles.enkelradFixed}>
              {draw.events.map((event, idx) => {
                const sign = getResultSign(event);
                const score = getScore(event);
                const isStarted = event.sportEventStatus !== 'Inte startat';
                const isFinished = event.isFinished || event.cancelled;
                const hasRecentGoal = !!changedEvents[event.eventNumber];
                const coveredSigns = new Set<string>();
                for (const row of rows) {
                  coveredSigns.add((row as any)[`m${idx + 1}`]);
                }
                const weCoveredResult = rows.length > 0 && coveredSigns.has(sign);

                return (
                  <View key={event.eventNumber} style={[
                    styles.enkelradMatchRow,
                    isStarted && !isFinished && styles.eventRowLive,
                    isFinished && styles.eventRowFinished,
                  ]}>
                    <Text style={styles.eventNr}>{event.eventNumber}</Text>
                    <TouchableOpacity style={styles.enkelradMatchInfo} onPress={() => openAnalysis(event)}>
                      <Text style={styles.eventTeams} numberOfLines={1}>
                        {event.home} - {event.away}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.enkelradResultArea}>
                      {!isStarted ? (
                        <Text style={styles.eventTimeText}>{formatTime(event.sportEventStart)}</Text>
                      ) : (
                        <View style={styles.scoreArea}>
                          {hasRecentGoal && <Text style={styles.goalIcon}>⚽</Text>}
                          {isFinished && !hasRecentGoal && <Text style={styles.ftPrefix}>FT</Text>}
                          <View style={[
                            styles.scoreBadge,
                            weCoveredResult ? styles.scoreBadgeCovered : styles.scoreBadgeNotCovered,
                            isFinished && { backgroundColor: '#fff' },
                          ]}>
                            <Text style={[styles.scoreBadgeText, weCoveredResult ? styles.scoreBadgeTextCovered : styles.scoreBadgeTextNotCovered]}>{score}</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
              {/* Footer row for "rätt" label */}
              <View style={styles.enkelradFooterRow}>
                <Text style={styles.enkelradFooterLabel}>Rätt</Text>
              </View>
            </View>

            {/* Scrollbar högerdel: enkelradskolumner */}
            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.enkelradScrollArea}>
              <View style={styles.enkelradColumns}>
                {sortedRows.slice(0, 20).map((row, colIdx) => {
                  const isEvenCol = colIdx % 2 === 0;
                  return (
                    <View key={row.radNr} style={[styles.enkelradCol, isEvenCol && styles.enkelradColEven]}>
                      {draw.events.map((event, idx) => {
                        const sign = getResultSign(event);
                        const rowSign = (row as any)[`m${idx + 1}`];
                        const isCorrect = rowSign === sign;
                        return (
                          <View
                            key={event.eventNumber}
                            style={[
                              styles.enkelBox,
                              isCorrect ? styles.enkelBoxCorrect : styles.enkelBoxWrong,
                            ]}
                          >
                            <Text style={[
                              styles.enkelBoxText,
                              isCorrect ? styles.enkelBoxTextCorrect : styles.enkelBoxTextWrong,
                            ]}>{rowSign}</Text>
                          </View>
                        );
                      })}
                      <View style={styles.enkelColFooter}>
                        <Text style={styles.enkelColFooterText}>{row.correct}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {/* Målrapport - expandable */}
      {(!noneStarted || mallista.length > 0) && (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => setMalrapportExpanded(!malrapportExpanded)}
        >
          <View style={styles.expandableHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="football-outline" size={20} color="#1B5E20" />
              <Text style={styles.cardTitle}>Målrapport</Text>
              {mallista.length > 0 && (
                <View style={styles.malCountBadge}>
                  <Text style={styles.malCountText}>{mallista.length}</Text>
                </View>
              )}
            </View>
            <Text style={styles.expandArrow}>{malrapportExpanded ? '▲' : '▼'}</Text>
          </View>
          {malrapportExpanded && (
            <View style={styles.expandableContent}>
              {mallista.length === 0 ? (
                <Text style={styles.malEmpty}>Inga mål ännu – vi bevakar matcherna ⚽</Text>
              ) : (
                mallista.map((g, idx) => {
                  const fh = parseInt(g.fromScore.split('-')[0]) || 0;
                  const fa = parseInt(g.fromScore.split('-')[1]) || 0;
                  const th = parseInt(g.toScore.split('-')[0]) || 0;
                  const ta = parseInt(g.toScore.split('-')[1]) || 0;
                  const homeScored = th > fh;
                  const awayScored = ta > fa;
                  // Aktuellt tecken efter målet, och om vi har det i vår utgångsrad (systemet)
                  const currentSign = th > ta ? '1' : th < ta ? '2' : 'X';
                  const covered = rows.length > 0 ? rows.some(r => (r as any)[`m${g.eventNumber}`] === currentSign) : null;
                  const time = new Date(g.detectedAtMs).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <View key={idx} style={[
                      styles.malRow,
                      covered === true && styles.malRowGood,
                      covered === false && styles.malRowBad,
                    ]}>
                      <View style={styles.malNrBadge}>
                        <Text style={styles.malNrText}>{g.eventNumber}</Text>
                      </View>
                      <View style={styles.malInfo}>
                        <Text style={styles.malTeams} numberOfLines={1}>{g.home} – {g.away}</Text>
                        <Text style={styles.malScoreLine}>
                          <Text style={homeScored ? styles.malGoalDigit : styles.malPlainDigit}>{th}</Text>
                          <Text style={styles.malPlainDigit}> – </Text>
                          <Text style={awayScored ? styles.malGoalDigit : styles.malPlainDigit}>{ta}</Text>
                        </Text>
                      </View>
                      {covered !== null && (
                        <View style={[styles.malSignBadge, covered ? styles.malSignGood : styles.malSignBad]}>
                          <Text style={[styles.malSignText, covered ? styles.malSignTextGood : styles.malSignTextBad]}>{currentSign}</Text>
                        </View>
                      )}
                      <View style={styles.malTimeCol}>
                        <Text style={styles.malTime}>{time}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Preliminär utdelning - expandable */}
      {rows.length > 0 && (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => setUtdelningExpanded(!utdelningExpanded)}
        >
          <View style={styles.expandableHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="cash-outline" size={20} color="#1B5E20" />
              <Text style={styles.cardTitle}>Preliminär utdelning</Text>
            </View>
            <Text style={styles.expandArrow}>{utdelningExpanded ? '▲' : '▼'}</Text>
          </View>
          {utdelningExpanded && (
            <View style={styles.expandableContent}>
              {distSplit && (
                <View style={styles.outcomeBox}>
                  <Text style={styles.outcomeTitle}>Utdelning vid olika utfall</Text>
                  <Text style={styles.outcomeMatch}>
                    {distSplit.event.home} – {distSplit.event.away}
                  </Text>
                  <View style={styles.outcomeButtons}>
                    {(['1', 'X', '2'] as const).map((s) => {
                      const active = effectiveDistSign === s;
                      const isCurrent = distSplit.currentSign === s;
                      return (
                        <TouchableOpacity
                          key={s}
                          style={[styles.outcomeBtn, active && styles.outcomeBtnActive]}
                          onPress={() => setSelectedDistSign(s)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.outcomeBtnText, active && styles.outcomeBtnTextActive]}>{s}</Text>
                          {isCurrent && (
                            <Text style={[styles.outcomeBtnNow, active && styles.outcomeBtnNowActive]}>nu</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
              {[13, 12, 11, 10].map((n) => (
                <View key={n} style={styles.rightRow}>
                  <Text style={styles.rightLabel}>{n} rätt</Text>
                  <Text style={styles.rightAmount}>{getDistAmount(n)} kr</Text>
                  <Text style={styles.rightValue}>{rightCount[n] || 0} st</Text>
                </View>
              ))}
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Garderingstabellen / Enkelradstabellen - expandable */}
      {garderingTable && garderingTable.table.length > 0 && (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => setGarderingExpanded(!garderingExpanded)}
        >
          <View style={styles.expandableHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="trophy-outline" size={20} color="#1B5E20" />
              <Text style={styles.cardTitle}>
                {garderingTable.isSlutspel === 1 ? 'Enkelradstabellen (just nu)' : 'Garderingstabellen (just nu)'}
              </Text>
            </View>
            <Text style={styles.expandArrow}>{garderingExpanded ? '▲' : '▼'}</Text>
          </View>
          {garderingExpanded && (
            <View style={styles.expandableContent}>
              {garderingTable.table.map((entry, idx) => {
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
                    onPress={() => canClick && openKupong()}
                    style={[
                      styles.garderingRow,
                      isLeader && styles.garderingRowLeader,
                      idx < garderingTable.table.length - 1 && styles.garderingRowBorder,
                    ]}
                  >
                    <View style={styles.garderingPosCol}>
                      {medal ? (
                        <Text style={styles.garderingMedal}>{medal}</Text>
                      ) : (
                        <Text style={styles.garderingPos}>{entry.position ?? '-'}</Text>
                      )}
                    </View>
                    <Text style={[styles.garderingName, isLeader && styles.garderingNameLeader]} numberOfLines={1}>
                      {entry.namn}
                    </Text>
                    <Text style={[
                      styles.garderingRatt,
                      entry.ratt === null && styles.garderingRattNull,
                      isLeader && styles.garderingRattLeader,
                    ]}>
                      {entry.ratt !== null ? `${entry.ratt} rätt` : 'ej tippat'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Grundtipsen - expandable */}
      {grundtipsen && grundtipsen.length > 0 && (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.8}
          onPress={() => setGrundtipsenExpanded(!grundtipsenExpanded)}
        >
          <View style={styles.expandableHeader}>
            <View style={styles.cardTitleRow}>
              <View style={styles.cardTitle1X2Badge}>
                <Text style={styles.cardTitle1X2Text}>1X2</Text>
              </View>
              <Text style={styles.cardTitle}>Grundtipsen (just nu)</Text>
            </View>
            <Text style={styles.expandArrow}>{grundtipsenExpanded ? '▲' : '▼'}</Text>
          </View>
          {grundtipsenExpanded && (
            <View style={styles.expandableContent}>
              {grundtipsen.map((match, idx) => {
                const isStarted = match.status !== 'Inte startat';
                const isFinished = match.isFinished || match.cancelled;
                const isLive = isStarted && !isFinished;
                const formatStartTime = (dateStr: string) => {
                  if (!dateStr) return '';
                  const d = new Date(dateStr);
                  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
                };

                return (
                  <View key={match.matchNr} style={[
                    styles.grundtipsenRow,
                    idx < grundtipsen.length - 1 && styles.grundtipsenRowBorder,
                  ]}>
                    <Text style={styles.grundtipsenNr}>{match.matchNr}</Text>
                    <Text style={styles.grundtipsenNamn} numberOfLines={1}>{match.ansvarig}</Text>

                    <View style={styles.grundtipsenResultCol}>
                      {!isStarted ? (
                        <Text style={styles.grundtipsenTime}>{formatStartTime(match.sportEventStart)}</Text>
                      ) : (
                        <View style={[
                          styles.grundtipsenScoreBadge,
                          isLive && (match.isCorrect ? styles.grundtipsenScoreCorrect : styles.grundtipsenScoreLive),
                        ]}>
                          {isFinished && <Text style={styles.grundtipsenFT}>FT</Text>}
                          <Text style={[styles.grundtipsenScore, match.isCorrect === true && styles.grundtipsenScoreTextCorrect]}>{match.score || '0-0'}</Text>
                        </View>
                      )}
                    </View>

                    <View style={[
                      styles.grundtipsenTeckenBox,
                      match.isCorrect === true && styles.grundtipsenTeckenCorrect,
                      match.isCorrect === false && styles.grundtipsenTeckenWrong,
                      match.isCorrect === null && styles.grundtipsenTeckenNeutral,
                    ]}>
                      <Text style={[
                        styles.grundtipsenTeckenText,
                        match.isCorrect === true && styles.grundtipsenTeckenTextCorrect,
                        match.isCorrect === false && styles.grundtipsenTeckenTextWrong,
                      ]}>{match.tecken || '-'}</Text>
                    </View>

                    <View style={styles.grundtipsenOddsCol}>
                      {match.isSTMF ? (
                        <View style={styles.grundtipsenStmfBadge}>
                          <Text style={styles.grundtipsenStmfText}>STMF</Text>
                        </View>
                      ) : (
                        <Text style={[
                          styles.grundtipsenOdds,
                          match.odds === 0 && styles.grundtipsenOddsZero,
                        ]}>{match.odds > 0 ? match.odds.toFixed(2) : '0'}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>

      {/* Matchanalys-modal */}
      <Modal visible={analysisModal.visible} transparent animationType="fade" onRequestClose={() => setAnalysisModal(prev => ({ ...prev, visible: false }))}>
        <View style={styles.analysisOverlay}>
          <View style={styles.analysisCard}>
            <View style={styles.analysisHeaderRow}>
              <Text style={styles.analysisTitle} numberOfLines={1}>
                {analysisModal.eventHome} vs {analysisModal.eventAway}
              </Text>
              <TouchableOpacity
                onPress={() => setAnalysisModal(prev => ({ ...prev, visible: false }))}
                style={styles.analysisCloseX}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color="#666" />
              </TouchableOpacity>
            </View>
            {!!analysisModal.league && <Text style={styles.analysisLeague}>{analysisModal.league}</Text>}
            <ScrollView style={styles.analysisScroll} contentContainerStyle={{ paddingBottom: 4 }}>
              {analysisModal.eventNumber != null && (() => {
                const ev = draw?.events?.find(e => e.eventNumber === analysisModal.eventNumber) || null;
                const score = ev ? getScore(ev) : '0-0';
                const goals = mallista
                  .filter(m => m.eventNumber === analysisModal.eventNumber)
                  .sort((a, b) => a.detectedAtMs - b.detectedAtMs);
                return (
                  <View style={styles.matchInfoBox}>
                    <View style={styles.matchInfoRow}>
                      <View style={styles.matchInfoNr}>
                        <Text style={styles.matchInfoNrText}>{analysisModal.eventNumber}</Text>
                      </View>
                      <Text style={styles.matchInfoStart}>
                        {analysisModal.startTime
                          ? new Date(analysisModal.startTime).toLocaleString('sv-SE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </Text>
                      <Text style={styles.matchInfoScore}>{score}</Text>
                    </View>
                    <View style={styles.matchGoalsBox}>
                      <Text style={styles.matchGoalsTitle}>Mål</Text>
                      {goals.length === 0 ? (
                        <Text style={styles.matchGoalsEmpty}>Inga mål ännu</Text>
                      ) : goals.map((g, i) => {
                        const fh = parseInt(g.fromScore.split('-')[0]) || 0;
                        const fa = parseInt(g.fromScore.split('-')[1]) || 0;
                        const th = parseInt(g.toScore.split('-')[0]) || 0;
                        const ta = parseInt(g.toScore.split('-')[1]) || 0;
                        const homeScored = th > fh;
                        const awayScored = ta > fa;
                        const t = new Date(g.detectedAtMs).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                        const scorer = homeScored ? analysisModal.eventHome : awayScored ? analysisModal.eventAway : '';
                        return (
                          <View key={i} style={styles.matchGoalRow}>
                            <Text style={styles.matchGoalTime}>{t}</Text>
                            <Text style={styles.matchGoalScore}>
                              <Text style={homeScored ? styles.matchGoalDigit : styles.matchGoalPlain}>{th}</Text>
                              <Text style={styles.matchGoalPlain}> – </Text>
                              <Text style={awayScored ? styles.matchGoalDigit : styles.matchGoalPlain}>{ta}</Text>
                            </Text>
                            <Text style={styles.matchGoalTeam} numberOfLines={1}>{scorer}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Kupong Modal */}
      <Modal
        visible={!!kupongModal || kupongLoading}
        transparent
        animationType="slide"
        onRequestClose={() => setKupongModal(null)}
      >
        <View style={styles.kupongOverlay}>
          <View style={styles.kupongContent}>
            {kupongLoading ? (
              <ActivityIndicator size="large" color="#1B5E20" />
            ) : kupongModal ? (
              <>
                <View style={styles.kupongHeader}>
                  <Text style={styles.kupongTitle}>
                    {kupongModal.isSlutspel ? 'Enkelrader' : 'Garderingar'}
                  </Text>
                  <Text style={styles.kupongSubtitle}>{kupongModal.spelomgang}</Text>
                </View>
                <ScrollView style={styles.kupongScroll}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                    <View>
                      {/* Header row */}
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
                <TouchableOpacity style={styles.kupongCloseBtn} onPress={() => setKupongModal(null)}>
                  <Text style={styles.kupongCloseBtnText}>Stäng</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

function getSignColor(sign: string | null): string {
  switch (sign) {
    case '1': return '#1B5E20';
    case 'X': return '#E65100';
    case '2': return '#1565C0';
    default: return '#999';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 16,
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
  noDataText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  noDataSubtext: {
    fontSize: 13,
    color: '#999',
    marginTop: 8,
  },
  upcomingHeader: {
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  upcomingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1B5E20',
  },
  upcomingSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  waitingHero: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E8F5E9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  waitingHeroEmoji: { fontSize: 40, marginBottom: 8 },
  waitingHeroTitle: { fontSize: 20, fontWeight: '700', color: '#333', marginBottom: 8 },
  waitingHeroSub: { fontSize: 14, color: '#888' },
  waitingHeroRader: { fontSize: 12, color: '#999', marginTop: 8 },
  systemDescText: { fontSize: 13, fontWeight: '500', color: '#888', marginTop: 12, textAlign: 'center' },
  startingRattRow: { alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0', width: '100%' },
  startingRattLabel: { fontSize: 13, color: '#666' },
  startingRattValue: { fontSize: 28, fontWeight: '800', color: '#1B5E20', marginVertical: 2 },
  startingRattSub: { fontSize: 11, color: '#aaa' },
  countdownRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  countdownLabel: { fontSize: 14, color: '#666' },
  countdownValue: { fontSize: 22, fontWeight: '800', color: '#1B5E20' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    backgroundColor: '#1B5E20',
    borderRadius: 10,
    padding: 14,
  },
  headerCol: {
    flexShrink: 1,
  },
  headerLabel: {
    fontSize: 11,
    color: '#A5D6A7',
  },
  headerBig: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  headerSmall: {
    fontSize: 12,
    color: '#C8E6C9',
  },
  headerExpanded: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
    marginTop: 10,
    paddingTop: 8,
  },
  headerExpandedText: {
    fontSize: 12,
    color: '#C8E6C9',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginBottom: 12,
  },
  cardTitle1X2Badge: {
    borderWidth: 1.5,
    borderColor: '#1B5E20',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  cardTitle1X2Text: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1B5E20',
    letterSpacing: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    borderRadius: 6,
  },
  eventRowLive: {
  },
  eventRowFinished: {
  },
  eventNr: {
    width: 20,
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
  },
  eventInfo: {
    flex: 1,
    marginRight: 8,
  },
  eventTeams: {
    fontSize: 13,
    fontWeight: '600',
    color: '#222',
  },
  eventLeague: {
    fontSize: 11,
    color: '#999',
  },
  eventResultArea: {
    width: 60,
    alignItems: 'center',
    marginRight: 12,
  },
  eventTimeText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  eventTimeStarted: {
    fontSize: 10,
    color: '#999',
    fontWeight: '500',
  },
  scoreArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  goalIcon: {
    fontSize: 12,
  },
  ftPrefix: {
    fontSize: 9,
    fontWeight: '700',
    color: '#666',
  },
  scoreBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  scoreBadgeCovered: {
    backgroundColor: '#E8F5E9',
    borderColor: '#2E7D32',
  },
  scoreBadgeNotCovered: {
    backgroundColor: '#FFEBEE',
    borderColor: '#C62828',
  },
  scoreBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scoreBadgeTextCovered: {
    color: '#1B5E20',
  },
  scoreBadgeTextNotCovered: {
    color: '#C62828',
  },
  signsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  signBox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signBoxCovered: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  signBoxUncovered: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  signBoxNeutral: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  signBoxText: {
    fontSize: 11,
    fontWeight: '700',
  },
  signBoxTextCovered: {
    color: '#1B5E20',
  },
  signBoxTextUncovered: {
    color: '#ccc',
  },
  signBoxTextNeutral: {
    color: '#666',
  },
  rightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  rightLabel: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
    width: 70,
  },
  rightAmount: {
    fontSize: 13,
    color: '#1B5E20',
    flex: 1,
    textAlign: 'center',
  },
  rightValue: {
    fontSize: 14,
    color: '#666',
    width: 50,
    textAlign: 'right',
  },
  outcomeBox: {
    backgroundColor: '#f1f8f2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#d4e8d7',
  },
  outcomeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1B5E20',
    marginBottom: 2,
  },
  outcomeMatch: {
    fontSize: 13,
    color: '#333',
    marginBottom: 10,
  },
  outcomeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  outcomeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#c8dccb',
    backgroundColor: '#fff',
  },
  outcomeBtnActive: {
    borderColor: '#1B5E20',
    backgroundColor: '#1B5E20',
  },
  outcomeBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B5E20',
  },
  outcomeBtnTextActive: {
    color: '#fff',
  },
  outcomeBtnNow: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1B5E20',
    marginLeft: 5,
    textTransform: 'uppercase',
  },
  outcomeBtnNowActive: {
    color: '#c8e6c9',
  },
  tabBar: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#e0e0e0',
    borderRadius: 8,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  tabTextActive: {
    color: '#1B5E20',
  },
  enkelradHeader: {
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  enkelradHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1B5E20',
  },
  enkelradContainer: {
    flexDirection: 'row',
  },
  enkelradFixed: {
    flexShrink: 0,
    width: '65%',
  },
  enkelradMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 4,
    paddingHorizontal: 2,
  },
  enkelradMatchInfo: {
    flex: 1,
    marginRight: 4,
  },
  enkelradResultArea: {
    width: 60,
    alignItems: 'center',
    marginRight: 4,
  },
  enkelradFooterRow: {
    height: 28,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  enkelradFooterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
  },
  enkelradScrollArea: {
    flex: 1,
  },
  enkelradColumns: {
    flexDirection: 'row',
  },
  enkelradCol: {
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 0,
    borderRadius: 6,
  },
  enkelradColEven: {
    backgroundColor: '#E8F5E9',
  },
  enkelBox: {
    width: 28,
    height: 28,
    marginVertical: 6,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  enkelBoxCorrect: {
    backgroundColor: '#1B5E20',
  },
  enkelBoxWrong: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  enkelBoxText: {
    fontSize: 13,
    fontWeight: '700',
  },
  enkelBoxTextCorrect: {
    color: '#fff',
  },
  enkelBoxTextWrong: {
    color: '#999',
  },
  enkelColFooter: {
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    width: '100%',
    marginTop: 4,
  },
  enkelColFooterText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1B5E20',
  },
  enkelradSign: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  enkelradSignCorrect: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1.5,
    borderColor: '#2E7D32',
  },
  enkelradSignWrong: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1.5,
    borderColor: '#C62828',
  },
  enkelradSignText: {
    fontSize: 13,
    fontWeight: '800',
  },
  enkelradSignTextCorrect: {
    color: '#1B5E20',
  },
  enkelradSignTextWrong: {
    color: '#C62828',
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
    maxHeight: '85%',
  },
  analysisHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  analysisScroll: {
    flexShrink: 1,
  },
  analysisStickyHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: '#fff',
    marginBottom: 2,
  },
  analysisCloseX: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  analysisTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
  },
  analysisLeague: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
    marginBottom: 12,
  },
  matchInfoBox: {
    backgroundColor: '#F1F8F2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#DCEBDF',
  },
  matchInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  matchInfoNr: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1B5E20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchInfoNrText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  matchInfoStart: { flex: 1, fontSize: 13, color: '#555', textTransform: 'capitalize' },
  matchInfoScore: { fontSize: 22, fontWeight: '900', color: '#1B5E20' },
  matchGoalsBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#CFE2D4',
  },
  matchGoalsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1B5E20',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  matchGoalsEmpty: { fontSize: 13, color: '#888', fontStyle: 'italic' },
  matchGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  matchGoalTime: { width: 48, fontSize: 13, fontWeight: '700', color: '#555' },
  matchGoalScore: { width: 60, fontSize: 15 },
  matchGoalDigit: { color: '#1B5E20', fontWeight: '900' },
  matchGoalPlain: { color: '#222', fontWeight: '600' },
  matchGoalTeam: { flex: 1, fontSize: 13, color: '#333', marginLeft: 8 },
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
  expandableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expandArrow: {
    fontSize: 12,
    color: '#999',
  },
  expandableContent: {
    marginTop: 12,
  },
  garderingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  garderingRowLeader: {
    backgroundColor: '#FFFDE7',
    borderRadius: 8,
    marginHorizontal: -4,
    paddingHorizontal: 8,
  },
  garderingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  garderingPosCol: {
    width: 32,
    alignItems: 'center',
  },
  garderingMedal: {
    fontSize: 18,
  },
  garderingPos: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
  },
  garderingName: {
    flex: 1,
    fontSize: 14,
    color: '#333',
    marginLeft: 8,
  },
  garderingNameLeader: {
    fontWeight: '700',
    color: '#222',
  },
  garderingRatt: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1B5E20',
    minWidth: 60,
    textAlign: 'right',
  },
  garderingRattNull: {
    color: '#bbb',
    fontWeight: '400',
    fontStyle: 'italic',
  },
  garderingRattLeader: {
    fontSize: 16,
    fontWeight: '800',
  },
  // Målrapport styles
  malCountBadge: {
    marginLeft: 8,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 11,
    backgroundColor: '#1B5E20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  malCountText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  malEmpty: { fontSize: 13, color: '#888', fontStyle: 'italic', paddingVertical: 8, textAlign: 'center' },
  malRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 5,
    backgroundColor: '#FAFAFA',
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  malRowGood: {
    backgroundColor: '#F1FAF3',
    borderLeftColor: '#2E7D32',
  },
  malRowBad: {
    backgroundColor: '#FDF3F3',
    borderLeftColor: '#C62828',
  },
  malNrBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#EAF3EC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  malNrText: { fontSize: 13, fontWeight: '800', color: '#1B5E20' },
  malInfo: { flex: 1 },
  malTeams: { fontSize: 14, color: '#333' },
  malScoreLine: { fontSize: 16, marginTop: 1 },
  malPlainDigit: { color: '#222', fontWeight: '600' },
  malGoalDigit: { color: '#1B5E20', fontWeight: '900' },
  malSignBadge: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    borderWidth: 1,
  },
  malSignGood: { backgroundColor: '#DCEEE1', borderColor: '#2E7D32' },
  malSignBad: { backgroundColor: '#FBDCDC', borderColor: '#C62828' },
  malSignText: { fontSize: 14, fontWeight: '800' },
  malSignTextGood: { color: '#1B5E20' },
  malSignTextBad: { color: '#C62828' },
  malTimeCol: { alignItems: 'flex-end', width: 42 },
  malTime: { fontSize: 14, fontWeight: '700', color: '#555' },

  // Grundtipsen styles
  grundtipsenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  grundtipsenRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  grundtipsenNr: {
    width: 20,
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  grundtipsenNamn: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    marginLeft: 6,
  },
  grundtipsenResultCol: {
    width: 50,
    alignItems: 'center',
    marginRight: 10,
  },
  grundtipsenTime: {
    fontSize: 11,
    color: '#999',
  },
  grundtipsenScoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  grundtipsenScoreLive: {
    borderWidth: 1.5,
    borderColor: '#E65100',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  grundtipsenScoreCorrect: {
    borderWidth: 1.5,
    borderColor: '#2E7D32',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  grundtipsenFT: {
    fontSize: 9,
    fontWeight: '700',
    color: '#666',
  },
  grundtipsenScore: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
  },
  grundtipsenScoreTextCorrect: {
    color: '#1B5E20',
  },
  grundtipsenTeckenBox: {
    width: 26,
    height: 26,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    marginRight: 8,
  },
  grundtipsenTeckenCorrect: {
    backgroundColor: '#E8F5E9',
    borderColor: '#2E7D32',
  },
  grundtipsenTeckenWrong: {
    backgroundColor: '#FFEBEE',
    borderColor: '#C62828',
  },
  grundtipsenTeckenNeutral: {
    backgroundColor: '#F5F5F5',
    borderColor: '#e0e0e0',
  },
  grundtipsenTeckenText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  grundtipsenTeckenTextCorrect: {
    color: '#1B5E20',
  },
  grundtipsenTeckenTextWrong: {
    color: '#C62828',
  },
  grundtipsenOddsCol: {
    width: 44,
    alignItems: 'flex-end',
  },
  grundtipsenOdds: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1B5E20',
  },
  grundtipsenOddsZero: {
    color: '#C62828',
  },
  grundtipsenStmfBadge: {
    backgroundColor: '#FFF3E0',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  grundtipsenStmfText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#E65100',
  },
  // Kupong modal styles
  kupongOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  kupongContent: {
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
  kupongHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  kupongTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1B5E20',
  },
  kupongSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  kupongScroll: {
    maxHeight: 400,
  },
  kupongCloseBtn: {
    marginTop: 16,
    backgroundColor: '#1B5E20',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  kupongCloseBtnText: {
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
