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
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const API_BASE_URL = 'https://tipsitjanst-api.azurewebsites.net/api/api';

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
  matematisk: number | null;
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

interface EkonomiData {
  spelomgang: string;
  sasong: number;
  antalRatt: number;
  veckansKapital: number;
  insats: number;
  vinst: number;
  extraInsats: number;
  extraVinst: number;
  utdelning: number;
  kommentar: string;
  isSlutspel: number;
  drawNumber: number;
  antalRader: number;
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
  const [panelMode, setPanelMode] = useState<'grund' | 'gard'>('grund');
  const [generateOnSave, setGenerateOnSave] = useState(false);
  const [omgangStatus, setOmgangStatus] = useState<'avsluta' | 'vantar' | 'startNy' | 'updateOdds'>('vantar');
  const [omgangLoading, setOmgangLoading] = useState(false);
  const [analysisModal, setAnalysisModal] = useState<{
    visible: boolean; home: any; away: any; standings: any[]; league: string;
    eventHome: string; eventAway: string; loading: boolean;
  }>({ visible: false, home: null, away: null, standings: [], league: '', eventHome: '', eventAway: '', loading: false });

  // Ekonomi state
  const [ekonomi, setEkonomi] = useState<EkonomiData | null>(null);
  const [ekoLoading, setEkoLoading] = useState(false);
  const [ekoSaving, setEkoSaving] = useState(false);

  const loadEkonomi = useCallback(async () => {
    if (!user || user.id !== 1) return;
    setEkoLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}?action=getEkonomiData&userId=${user.id}`);
      const json = await resp.json();
      if (!json.error) {
        setEkonomi(json);
      }
    } catch { }
    setEkoLoading(false);
  }, [user]);

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
      loadEkonomi();
      loadOmgangStatus();
    }, [loadData, loadEkonomi, loadOmgangStatus])
  );

  const saveEkonomi = async () => {
    if (!user || !ekonomi) return;
    setEkoSaving(true);
    try {
      const resp = await fetch(`${API_BASE_URL}?action=saveEkonomi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          veckansKapital: ekonomi.veckansKapital,
          insats: ekonomi.insats,
          vinst: ekonomi.vinst,
          antalRatt: ekonomi.antalRatt,
          isSlutspel: ekonomi.isSlutspel,
          extraInsats: ekonomi.extraInsats,
          extraVinst: ekonomi.extraVinst,
          kommentar: ekonomi.kommentar,
          utdelning: ekonomi.utdelning,
        }),
      });
      const json = await resp.json();
      if (json.success) {
        Alert.alert('Sparat', 'Ekonomi sparad!');
      } else {
        Alert.alert('Fel', json.error || 'Kunde inte spara');
      }
    } catch (err: any) {
      Alert.alert('Fel', err.message);
    } finally {
      setEkoSaving(false);
    }
  };

  const updateEkonomi = (field: keyof EkonomiData, value: string | number) => {
    if (!ekonomi) return;
    setEkonomi({ ...ekonomi, [field]: value });
  };

  const loadOmgangStatus = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE_URL}?action=getOmgangStatus`);
      const json = await resp.json();
      if (json.status) setOmgangStatus(json.status);
    } catch { }
  }, []);

  const handleAvslutaOmgang = async () => {
    setOmgangLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}?action=avslutaOmgang`);
      const json = await resp.json();
      if (json.success) {
        Alert.alert(
          'Omgång avslutad!',
          `Omgång: ${json.spelomgang}\nAntal rätt: ${json.antalRatt}\nInsats: ${json.insats} rader\nVinst: ${json.vinst} kr${json.tipsAllsvenskanUpdated ? '\n\nTipsAllsvenskan uppdaterad ✓' : ''}`
        );
        loadData();
        loadEkonomi();
        loadOmgangStatus();
      } else {
        Alert.alert('Fel', json.error || 'Kunde inte avsluta omgång');
      }
    } catch (err: any) {
      Alert.alert('Fel', err.message);
    }
    setOmgangLoading(false);
  };

  const handleStartNyOmgang = async () => {
    setOmgangLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}?action=startNyOmgang&veckansKapital=260&isSlutspel=0`);
      const json = await resp.json();
      if (json.success) {
        Alert.alert(
          'Ny omgång startad!',
          `Omgång: ${json.spelomgang}\nDraw: ${json.drawNumber}\nMatcher: ${json.antalMatcher}\nDeltagare: ${json.antalDeltagare}`
        );
        loadData();
        loadEkonomi();
        loadOmgangStatus();
      } else {
        Alert.alert('Fel', json.error || 'Kunde inte starta ny omgång');
      }
    } catch (err: any) {
      Alert.alert('Fel', err.message);
    }
    setOmgangLoading(false);
  };

  const handleUpdateOdds = async () => {
    setOmgangLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}?action=updateOdds`);
      const json = await resp.json();
      if (json.success) {
        Alert.alert('Odds uppdaterade', `${json.updated} matcher uppdaterade`);
        loadData();
      } else {
        Alert.alert('Fel', json.error || 'Kunde inte uppdatera odds');
      }
    } catch (err: any) {
      Alert.alert('Fel', err.message);
    }
    setOmgangLoading(false);
  };

  const [pushLoading, setPushLoading] = useState(false);
  const handleRunNotifications = async () => {
    setPushLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}?action=runNotificationsNow`);
      const json = await resp.json();
      if (json.success) {
        Alert.alert('Push kört', `Notisjobbet kördes ${json.ranAt}`);
      } else {
        Alert.alert('Fel', json.error || 'Kunde inte köra notisjobb');
      }
    } catch (err: any) {
      Alert.alert('Fel', err.message);
    }
    setPushLoading(false);
  };

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

  const toggleMatematisk = (matchNr: number) => {
    setMatches(prev => prev.map(m => {
      if (m.matchNr !== matchNr) return m;
      return { ...m, matematisk: m.matematisk === 1 ? 0 : 1 };
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
        matematisk: m.matematisk || 0,
        ansvarigId: m.ansvarigId || 0,
      }));
      const resp = await fetch(`${API_BASE_URL}?action=saveAdminTipsrad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, matches: payload }),
      });
      const json = await resp.json();
      if (json.success) {
        if (generateOnSave) {
          // Also generate system
          const incomplete = matches.some(m => !m.grundtecken);
          if (incomplete) {
            Alert.alert('Sparat', 'Tipsraden sparad!\n\n⚠ System ej skapat – alla 13 måste ha grundtecken.');
            setHasChanges(false);
            return;
          }
          const sysPayload = matches.map(m => ({
            matchNr: m.matchNr,
            tecken: m.grundtecken || '',
            evGardering: m.evGardering || '',
            matematisk: m.matematisk || 0,
          }));
          const sysResp = await fetch(`${API_BASE_URL}?action=generateSystem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user!.id, matches: sysPayload }),
          });
          const sysJson = await sysResp.json();
          if (sysJson.success) {
            const file = new File(Paths.cache, 'SvenskaSpelRader.txt');
            file.write(sysJson.fileContent);
            const fileUri = file.uri;
            Alert.alert(
              'Sparat + System skapat!',
              `${sysJson.antalRader} rader (${sysJson.garantiNiva}-rättsgaranti)`,
              [
                { text: 'OK' },
                {
                  text: 'Dela fil',
                  onPress: async () => {
                    if (await Sharing.isAvailableAsync()) {
                      await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'SvenskaSpelRader.txt' });
                    } else {
                      Alert.alert('Delning ej tillgänglig');
                    }
                  },
                },
              ]
            );
            loadEkonomi();
          } else {
            Alert.alert('Sparat', `Tipsraden sparad!\n\n⚠ System-fel: ${sysJson.error || 'Okänt'}`);
          }
        } else {
          Alert.alert('Sparat', 'Tipsraden sparad!');
        }
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
  const helgarderingar = matches.filter(m => (m.evGardering?.length || 0) === 2).length;
  const halvgarderingar = matches.filter(m => (m.evGardering?.length || 0) === 1).length;
  const antalRader = helgarderingar > 0 || halvgarderingar > 0
    ? Math.pow(3, helgarderingar) * Math.pow(2, halvgarderingar)
    : (grundradComplete ? 1 : 0);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 100 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); loadEkonomi(); }} />}
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
          <Text style={styles.summaryLabel}>Nuv. system</Text>
          <Text style={styles.summaryValue}>
            {helgarderingar} hel – {halvgarderingar} halv – {antalRader} rader
          </Text>
        </View>
        {hasChanges && (
          <Text style={styles.unsavedText}>⚠ Osparade ändringar</Text>
        )}
      </View>

      {/* Match list */}
      <View style={styles.matchCard}>
        {/* Panel toggle tabs */}
        <View style={styles.panelTabs}>
          <TouchableOpacity
            style={[styles.panelTab, panelMode === 'grund' && styles.panelTabActive]}
            onPress={() => setPanelMode('grund')}
          >
            <Text style={[styles.panelTabText, panelMode === 'grund' && styles.panelTabTextActive]}>Grundrad</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.panelTab, panelMode === 'gard' && styles.panelTabActive]}
            onPress={() => setPanelMode('gard')}
          >
            <Text style={[styles.panelTabText, panelMode === 'gard' && styles.panelTabTextActive]}>Gardering</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.colHeader}>
          <Text style={[styles.colHeaderText, { width: 28 }]}>#</Text>
          <Text style={[styles.colHeaderText, { flex: 1 }]}>Match</Text>
          <Text style={[styles.colHeaderText, { width: 90 }]}>
            {panelMode === 'grund' ? 'Grund' : 'Gard'}
          </Text>
          <Text style={[styles.colHeaderText, { width: 28 }]}>
            {panelMode === 'grund' ? 'SM' : 'Mat.'}
          </Text>
        </View>

        {matches.map((match, idx) => {
          const grund = match.grundtecken;
          const gard = match.evGardering || '';
          const isSTMF = match.poangGrund === 1;
          const isMat = match.matematisk === 1;
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

              {panelMode === 'grund' ? (
                <>
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

                  {/* STMF toggle */}
                  <TouchableOpacity
                    style={[styles.stmfBtn, isSTMF && styles.stmfBtnActive]}
                    onPress={() => toggleSTMF(match.matchNr)}
                  >
                    <Text style={[styles.stmfText, isSTMF && styles.stmfTextActive]}>
                      {isSTMF ? '!' : '·'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
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

                  {/* Matematisk toggle */}
                  <TouchableOpacity
                    style={[styles.stmfBtn, isMat && styles.matBtnActive]}
                    onPress={() => toggleMatematisk(match.matchNr)}
                  >
                    <Text style={[styles.matText, isMat && styles.stmfTextActive]}>
                      {isMat ? 'M' : ''}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          );
        })}
      </View>

      {/* Save row with checkbox */}
      <View style={styles.saveRow}>
        <TouchableOpacity
          style={[styles.saveBtn, !(hasChanges || generateOnSave) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!(hasChanges || generateOnSave) || saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>
              {(hasChanges || generateOnSave) ? 'Spara' : 'Inga ändringar'}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.genCheckRow}
          onPress={() => setGenerateOnSave(!generateOnSave)}
          activeOpacity={0.7}
        >
          <View style={[styles.genCheckbox, generateOnSave && styles.genCheckboxActive]}>
            {generateOnSave && <Text style={styles.genCheckmark}>✓</Text>}
          </View>
          <Text style={styles.genCheckLabel}>Skapa system</Text>
        </TouchableOpacity>
      </View>

      {/* Dynamic action button */}
      <View style={styles.avslutaSection}>
        <TouchableOpacity
          style={[
            styles.avslutaBtn,
            omgangStatus === 'vantar' && styles.avslutaBtnDisabled,
            omgangStatus === 'startNy' && styles.startNyBtn,
            omgangStatus === 'updateOdds' && styles.updateOddsBtn,
          ]}
          disabled={omgangStatus === 'vantar' || omgangLoading}
          onPress={() => {
            if (omgangStatus === 'avsluta') {
              Alert.alert(
                'Avsluta omgång',
                `Är du säker på att du vill avsluta omgång ${data.spelomgang}?\n\nDetta uppdaterar rätt rad, ekonomi och TipsAllsvenskan.`,
                [
                  { text: 'Avbryt', style: 'cancel' },
                  { text: 'Avsluta', style: 'destructive', onPress: handleAvslutaOmgang },
                ]
              );
            } else if (omgangStatus === 'startNy') {
              Alert.alert(
                'Starta ny omgång',
                'Vill du initiera nästa omgång?\n\n• Ny post i ekonomi\n• Hämta kupong\n• Lotta matcher\n• Öppna spelet',
                [
                  { text: 'Avbryt', style: 'cancel' },
                  { text: 'Starta', onPress: handleStartNyOmgang },
                ]
              );
            } else if (omgangStatus === 'updateOdds') {
              handleUpdateOdds();
            }
          }}
        >
          {omgangLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.avslutaBtnText}>
              {omgangStatus === 'avsluta' && 'Avsluta omgång'}
              {omgangStatus === 'vantar' && 'Väntar på nästa omg'}
              {omgangStatus === 'startNy' && 'Starta ny omgång'}
              {omgangStatus === 'updateOdds' && 'Uppdatera odds'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.avslutaBtn, styles.pushBtn, { marginTop: 12 }]}
          disabled={pushLoading}
          onPress={handleRunNotifications}
        >
          {pushLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.avslutaBtnText}>Skicka push nu</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ===== EKONOMI SECTION ===== */}
      <View style={styles.ekoSection}>
        <Text style={styles.ekoTitle}>💰 Ekonomi</Text>
        <Text style={styles.ekoSubtitle}>Omgång {ekonomi?.spelomgang || data.spelomgang}</Text>

        {ekoLoading ? (
          <ActivityIndicator color="#1B5E20" style={{ marginVertical: 16 }} />
        ) : ekonomi ? (
          <>
            {/* Säsong (read-only) */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Säsong</Text>
              <Text style={styles.ekoReadOnly}>{ekonomi.sasong}</Text>
            </View>

            {/* Antal rätt */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Antal rätt</Text>
              <TextInput
                style={styles.ekoInput}
                value={String(ekonomi.antalRatt || 0)}
                onChangeText={v => updateEkonomi('antalRatt', v)}
                keyboardType="numeric"
              />
            </View>

            {/* Veckans kapital */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Veckans kapital</Text>
              <TextInput
                style={styles.ekoInput}
                value={String(ekonomi.veckansKapital || 260)}
                onChangeText={v => updateEkonomi('veckansKapital', v)}
                keyboardType="numeric"
              />
            </View>

            {/* Insats */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Insats (rader: {ekonomi.antalRader})</Text>
              <TextInput
                style={styles.ekoInput}
                value={String(ekonomi.insats || 0)}
                onChangeText={v => updateEkonomi('insats', v)}
                keyboardType="numeric"
              />
            </View>

            {/* Vinst */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Vinst</Text>
              <TextInput
                style={styles.ekoInput}
                value={String(ekonomi.vinst || 0)}
                onChangeText={v => updateEkonomi('vinst', v)}
                keyboardType="numeric"
              />
            </View>

            {/* Slutspel */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Slutspelsomgång</Text>
              <Switch
                value={ekonomi.isSlutspel === 1}
                onValueChange={v => updateEkonomi('isSlutspel', v ? 1 : 0)}
                trackColor={{ false: '#ccc', true: '#81C784' }}
                thumbColor={ekonomi.isSlutspel === 1 ? '#1B5E20' : '#999'}
              />
            </View>

            {/* Extra insats */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Extra insats</Text>
              <TextInput
                style={styles.ekoInput}
                value={String(ekonomi.extraInsats || 0)}
                onChangeText={v => updateEkonomi('extraInsats', v)}
                keyboardType="numeric"
              />
            </View>

            {/* Extra vinst */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Extra vinst</Text>
              <TextInput
                style={styles.ekoInput}
                value={String(ekonomi.extraVinst || 0)}
                onChangeText={v => updateEkonomi('extraVinst', v)}
                keyboardType="numeric"
              />
            </View>

            {/* Utdelning */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Utdelning</Text>
              <TextInput
                style={styles.ekoInput}
                value={String(ekonomi.utdelning || 0)}
                onChangeText={v => updateEkonomi('utdelning', v)}
                keyboardType="numeric"
              />
            </View>

            {/* Kommentar */}
            <View style={styles.ekoRow}>
              <Text style={styles.ekoLabel}>Kommentar</Text>
              <TextInput
                style={[styles.ekoInput, { flex: 1 }]}
                value={ekonomi.kommentar}
                onChangeText={v => updateEkonomi('kommentar', v)}
              />
            </View>

            {/* Spara ekonomi button */}
            <TouchableOpacity style={styles.ekoSaveBtn} onPress={saveEkonomi} disabled={ekoSaving}>
              {ekoSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ekoSaveBtnText}>Spara ekonomi</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.ekoNoData}>Ingen ekonomidata tillgänglig</Text>
        )}
      </View>

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
    </KeyboardAvoidingView>
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
  panelTabs: {
    flexDirection: 'row', marginHorizontal: 8, marginTop: 4, marginBottom: 8,
    backgroundColor: '#F0F0F0', borderRadius: 8, padding: 3,
  },
  panelTab: {
    flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center',
  },
  panelTabActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  panelTabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  panelTabTextActive: { color: '#1B5E20' },
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
  matBtnActive: { backgroundColor: '#7B1FA2', borderColor: '#7B1FA2' },
  matText: { fontSize: 11, fontWeight: '700', color: '#ccc' },
  stmfText: { fontSize: 14, fontWeight: '700', color: '#ccc' },
  stmfTextActive: { color: '#fff' },

  saveRow: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, gap: 12,
  },
  saveBtn: {
    flex: 1, backgroundColor: '#1B5E20', borderRadius: 12, padding: 14,
    alignItems: 'center', shadowColor: '#1B5E20', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  saveBtnDisabled: { backgroundColor: '#BDBDBD', shadowOpacity: 0, elevation: 0 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  genCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  genCheckbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#999',
    alignItems: 'center', justifyContent: 'center',
  },
  genCheckboxActive: { backgroundColor: '#E65100', borderColor: '#E65100' },
  genCheckmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  genCheckLabel: { fontSize: 12, color: '#666', fontWeight: '500' },

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

  // Ekonomi styles
  ekoSection: {
    backgroundColor: '#fff', borderRadius: 12, marginHorizontal: 16, marginTop: 24, marginBottom: 16,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  ekoTitle: { fontSize: 18, fontWeight: '800', color: '#1B5E20', textAlign: 'center' },
  ekoSubtitle: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 16 },
  ekoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  ekoLabel: { fontSize: 14, color: '#333', fontWeight: '500', flex: 1 },
  ekoReadOnly: { fontSize: 14, fontWeight: '700', color: '#666', paddingHorizontal: 12, paddingVertical: 6 },
  ekoInput: {
    fontSize: 14, fontWeight: '600', color: '#333', backgroundColor: '#F5F5F5',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, minWidth: 80, textAlign: 'right',
    borderWidth: 1, borderColor: '#E0E0E0',
  },
  ekoSaveBtn: {
    backgroundColor: '#1565C0', borderRadius: 10, padding: 14,
    alignItems: 'center', marginTop: 20,
  },
  ekoSaveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ekoNoData: { fontSize: 14, color: '#999', textAlign: 'center', marginVertical: 16 },
  avslutaSection: { marginTop: 24, paddingHorizontal: 16 },
  avslutaBtn: {
    backgroundColor: '#B71C1C', borderRadius: 10, padding: 16,
    alignItems: 'center',
  },
  avslutaBtnDisabled: {
    backgroundColor: '#999',
  },
  startNyBtn: {
    backgroundColor: '#1B5E20',
  },
  updateOddsBtn: {
    backgroundColor: '#1565C0',
  },
  pushBtn: {
    backgroundColor: '#6A1B9A',
  },
  avslutaBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
