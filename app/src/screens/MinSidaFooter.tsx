import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, MinSidaData, TopplistaData } from '../services/api';

const GREEN = '#1B5E20';
const RED = '#C62828';

export default function MinSidaFooter({ userId }: { userId: number }) {
  const [data, setData] = useState<MinSidaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showPayments, setShowPayments] = useState(false);
  const [showTopplista, setShowTopplista] = useState(false);
  const [topplista, setTopplista] = useState<TopplistaData | null>(null);
  const [toppSort, setToppSort] = useState<'iAr' | 'total'>('iAr');
  const [toppLoading, setToppLoading] = useState(false);

  const openTopplista = async () => {
    setShowTopplista(true);
    if (!topplista) {
      setToppLoading(true);
      try {
        setTopplista(await api.getTopplista());
      } catch (e) {
        console.error('Topplista error:', e);
      } finally {
        setToppLoading(false);
      }
    }
  };

  const load = useCallback(async () => {
    try {
      setData(await api.getMinSida(userId));
    } catch (e) {
      console.error('MinSida footer error:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={GREEN} />
      </View>
    );
  }

  if (!data) return null;

  const st = data.statistik;

  const teckenPct = (tkn: '1' | 'X' | '2') => {
    const p = data.perTecken[tkn];
    return p.antal > 0 ? Math.round((p.ratt / p.antal) * 100) : 0;
  };

  const hasDebt = data.skuld < 0;
  const debtCard = (
    <TouchableOpacity
      style={[styles.debtCard, hasDebt ? styles.debtCardRed : styles.debtCardGreen]}
      onPress={() => setShowPayments(true)}
      activeOpacity={0.8}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.debtLabel, { color: hasDebt ? RED : GREEN }]}>
          {hasDebt ? 'Nuvarande skuld' : 'Betalningsstatus'}
        </Text>
        <Text style={[styles.debtValue, { color: hasDebt ? RED : GREEN }]}>
          {hasDebt ? `${data.skuld} kr` : 'Inga skulder ✓'}
        </Text>
        <Text style={styles.debtHint}>Tryck för betalningshistorik</Text>
      </View>
      <Text style={[styles.debtChevron, { color: hasDebt ? RED : GREEN }]}>›</Text>
    </TouchableOpacity>
  );

  const sortedTopp = topplista
    ? [...topplista.lista].sort((a, b) => {
        const bd = toppSort === 'iAr' ? b.iAr : b.total;
        const ad = toppSort === 'iAr' ? a.iAr : a.total;
        if (bd.traffProcent !== ad.traffProcent) return bd.traffProcent - ad.traffProcent;
        return bd.avgjorda - ad.avgjorda;
      })
    : [];

  return (
    <View style={styles.wrapper}>
      {hasDebt && debtCard}

      {/* Personlig statistik – tryck för topplista */}
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={openTopplista}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>📊 Min statistik</Text>
          <Text style={styles.topplistaHint}>🏆 Topplista ›</Text>
        </View>
        <View style={styles.statHeadRow}>
          <Text style={styles.statHeadLabel} />
          <Text style={styles.statHeadCol}>I år</Text>
          <Text style={styles.statHeadCol}>Totalt</Text>
        </View>
        <StatLine label="Tippade" iar={st.iAr.tippade} total={st.total.tippade} />
        <StatLine label="Rätt" iar={st.iAr.ratt} total={st.total.ratt} color={GREEN} />
        <StatLine label="Fel" iar={st.iAr.fel} total={st.total.fel} color={RED} />
        <StatLine label="STMF" iar={st.iAr.stmf} total={st.total.stmf} color="#F57F17" />
        <StatLine label="Träffprocent" iar={`${st.iAr.traffProcent}%`} total={`${st.total.traffProcent}%`} bold />
        <Text style={styles.statNote}>Träffprocent räknas exkl. STMF</Text>
        <View style={styles.streakRow}>
          <Text style={styles.streakText}>🔥 Längsta streak</Text>
          <Text style={styles.streakValue}>{data.bastaStreak} rätt i rad</Text>
        </View>
      </TouchableOpacity>

      {/* Favorittecken + träffsäkerhet per tecken */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🎲 Dina tecken</Text>
        {data.favorittecken && (
          <Text style={styles.favText}>
            Favorittecken: <Text style={styles.favTecken}>{data.favorittecken}</Text>
          </Text>
        )}
        {(['1', 'X', '2'] as const).map((tkn) => {
          const p = data.perTecken[tkn];
          const pct = teckenPct(tkn);
          return (
            <View key={tkn} style={styles.teckenRow}>
              <Text style={styles.teckenLabel}>{tkn}</Text>
              <View style={styles.teckenBarBg}>
                <View style={[styles.teckenBarFill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.teckenStat} numberOfLines={1}>{p.ratt}/{p.antal} · {pct}%</Text>
            </View>
          );
        })}
      </View>

      {/* Placering bland medlemmarna */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🏅 Din placering</Text>
        <View style={styles.statHeadRow}>
          <Text style={styles.statHeadLabel} />
          <Text style={styles.statHeadCol}>I år</Text>
          <Text style={styles.statHeadCol}>Totalt</Text>
        </View>
        <StatLine
          label="Träffsäkerhet"
          iar={data.rank.traffPlatsIAr ? `#${data.rank.traffPlatsIAr}` : '–'}
          total={data.rank.traffPlatsTotal ? `#${data.rank.traffPlatsTotal}` : '–'}
          bold
        />
        <StatLine
          label="STMF"
          iar={data.rank.stmfPlatsIAr ? `#${data.rank.stmfPlatsIAr}` : '–'}
          total={data.rank.stmfPlatsTotal ? `#${data.rank.stmfPlatsTotal}` : '–'}
        />
        <Text style={styles.statNote}>av {data.rank.antalMedlemmar} medlemmar</Text>
      </View>

      {!hasDebt && debtCard}

      {/* Tipshistorik (hopfällbar) */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => setShowHistory((v) => !v)}>
          <Text style={styles.cardTitle}>🎯 Tipshistorik (säsongen)</Text>
          <Text style={styles.chevron}>{showHistory ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showHistory &&
          (data.tipshistorik.length === 0 ? (
            <Text style={styles.empty}>Ingen tipshistorik denna säsong</Text>
          ) : (
            <>
              <View style={styles.histHeader}>
                <Text style={[styles.histTh, { flex: 1.4 }]}>Omgång</Text>
                <Text style={[styles.histTh, { flex: 0.8 }]}>Match</Text>
                <Text style={[styles.histTh, { flex: 0.7, textAlign: 'center' }]}>Ditt</Text>
                <Text style={[styles.histTh, { flex: 0.7, textAlign: 'center' }]}>Facit</Text>
                <Text style={[styles.histTh, { flex: 0.6, textAlign: 'center' }]}> </Text>
              </View>
              {data.tipshistorik.map((t, i) => (
                <View key={i} style={styles.histRow}>
                  <Text style={[styles.histTd, { flex: 1.4 }]}>{t.spelomgang}</Text>
                  <Text style={[styles.histTd, { flex: 0.8 }]}>{t.matchNr}</Text>
                  <Text style={[styles.histTd, { flex: 0.7, textAlign: 'center' }]}>{t.tecken ?? '-'}</Text>
                  <Text style={[styles.histTd, { flex: 0.7, textAlign: 'center' }]}>{t.facit ?? '-'}</Text>
                  <Text style={[styles.histTd, { flex: 0.6, textAlign: 'center' }]}>
                    {t.correct === null ? '' : t.correct ? '✅' : '❌'}
                  </Text>
                </View>
              ))}
            </>
          ))}
      </View>

      {/* Betalningshistorik-modal */}
      <Modal visible={showPayments} transparent animationType="slide" onRequestClose={() => setShowPayments(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowPayments(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Betalningshistorik</Text>
              <TouchableOpacity onPress={() => setShowPayments(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>Betalt totalt: {data.harBetalt} kr</Text>
              <Text style={styles.summaryText}>Borde ha betalt: {data.bordeHaBetalt} kr</Text>
            </View>
            <Text style={[styles.summaryDebt, { color: data.skuld < 0 ? RED : GREEN }]}>
              {data.skuld < 0 ? `Skuld: ${data.skuld} kr` : 'Inga skulder'}
            </Text>

            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {data.betalningar.map((b) => (
                <View key={b.sasong} style={styles.payRow}>
                  <Text style={styles.payLabel}>Säsong {b.sasong}</Text>
                  <View style={styles.payRight}>
                    {b.datum ? <Text style={styles.payDatum}>{b.datum}</Text> : null}
                    <Text style={[styles.payBadge, { backgroundColor: b.betald ? GREEN : RED }]}>{b.avgift} kr</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Topplista-modal */}
      <Modal visible={showTopplista} transparent animationType="slide" onRequestClose={() => setShowTopplista(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTopplista(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🏆 Topplista – träffprocent</Text>
              <TouchableOpacity onPress={() => setShowTopplista(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.toppToggle}>
              <TouchableOpacity
                style={[styles.toppToggleBtn, toppSort === 'iAr' && styles.toppToggleActive]}
                onPress={() => setToppSort('iAr')}
              >
                <Text style={[styles.toppToggleText, toppSort === 'iAr' && styles.toppToggleTextActive]}>
                  I år{topplista?.ar ? ` (${topplista.ar})` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toppToggleBtn, toppSort === 'total' && styles.toppToggleActive]}
                onPress={() => setToppSort('total')}
              >
                <Text style={[styles.toppToggleText, toppSort === 'total' && styles.toppToggleTextActive]}>Totalt</Text>
              </TouchableOpacity>
            </View>

            {toppLoading ? (
              <ActivityIndicator color={GREEN} style={{ marginVertical: 24 }} />
            ) : (
              <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ paddingBottom: 8 }}>
                {sortedTopp.map((rad, i) => {
                  const d = toppSort === 'iAr' ? rad.iAr : rad.total;
                  const isMe = rad.id === userId;
                  return (
                    <View key={rad.id} style={[styles.toppRow, isMe && styles.toppRowMe]}>
                      <Text style={styles.toppRank}>{i + 1}</Text>
                      <Text style={[styles.toppNamn, isMe && styles.toppNamnMe]} numberOfLines={1}>{rad.namn}</Text>
                      <Text style={styles.toppSmall}>{d.ratt}/{d.avgjorda}</Text>
                      <Text style={styles.toppPct}>{d.avgjorda > 0 ? `${d.traffProcent}%` : '–'}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <Text style={styles.statNote}>Träffprocent räknas exkl. STMF</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function StatLine({
  label,
  iar,
  total,
  color,
  bold,
}: {
  label: string;
  iar: number | string;
  total: number | string;
  color?: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.statLineRow}>
      <Text style={[styles.statLineLabel, bold && styles.statLineBold]}>{label}</Text>
      <Text style={[styles.statLineCol, color ? { color } : null, bold && styles.statLineBold]}>{iar}</Text>
      <Text style={[styles.statLineCol, color ? { color } : null, bold && styles.statLineBold]}>{total}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: 16, paddingTop: 4 },
  loadingBox: { padding: 20, alignItems: 'center' },
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: GREEN },
  chevron: { fontSize: 12, color: '#999' },
  topplistaHint: { fontSize: 13, fontWeight: '700', color: '#F57F17' },
  empty: { color: '#888', fontStyle: 'italic', paddingVertical: 8 },

  debtCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  debtCardRed: { backgroundColor: '#FFEBEE', borderColor: '#FFCDD2' },
  debtCardGreen: { backgroundColor: '#E8F5E9', borderColor: '#C8E6C9' },
  debtLabel: { fontSize: 13, fontWeight: '700' },
  debtValue: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  debtHint: { fontSize: 12, color: '#888', marginTop: 4 },
  debtChevron: { fontSize: 28, marginLeft: 8 },

  statsGrid: { flexDirection: 'row', marginTop: 12, marginBottom: 8 },
  statBox: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 2 },
  rateRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  rateLabel: { fontSize: 13, color: '#555', width: 90 },
  rateBarBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#eee', marginHorizontal: 8, overflow: 'hidden' },
  rateBarFill: { height: 8, borderRadius: 4, backgroundColor: GREEN },
  rateValue: { fontSize: 13, fontWeight: '700', color: '#333', width: 40, textAlign: 'right' },

  statHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  statHeadLabel: { flex: 1.4 },
  statHeadCol: { flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '700', color: '#999' },
  statLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f5f5f5',
  },
  statLineLabel: { flex: 1.4, fontSize: 14, color: '#555' },
  statLineCol: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '600', color: '#333' },
  statLineBold: { fontWeight: '800' },
  statNote: { fontSize: 11, color: '#aaa', fontStyle: 'italic', marginTop: 6 },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  badgeIcon: { fontSize: 15, marginRight: 6 },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#444' },

  streakRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  streakText: { fontSize: 13, color: '#555' },
  streakValue: { fontSize: 14, fontWeight: '700', color: '#EF6C00' },

  favText: { fontSize: 14, color: '#555', marginBottom: 10 },
  favTecken: { fontSize: 16, fontWeight: '800', color: GREEN },
  teckenRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  teckenLabel: { fontSize: 15, fontWeight: '700', color: '#333', width: 18 },
  teckenBarBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#eee', marginHorizontal: 6, overflow: 'hidden' },
  teckenBarFill: { height: 8, borderRadius: 4, backgroundColor: '#42A5F5' },
  teckenStat: { fontSize: 11, color: '#666', width: 104, textAlign: 'right' },

  rankRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  rankLabel: { fontSize: 14, color: '#333' },
  rankValue: { fontSize: 18, fontWeight: '800', color: GREEN },
  rankOf: { fontSize: 13, fontWeight: '400', color: '#999' },

  histHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 6,
    marginTop: 10,
  },
  histTh: { fontSize: 11, fontWeight: '700', color: '#999' },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  histTd: { fontSize: 13, color: '#333' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: GREEN },
  modalClose: { fontSize: 20, color: '#999' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryText: { fontSize: 13, color: '#555' },
  summaryDebt: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  payLabel: { fontSize: 14, color: '#333' },
  payRight: { flexDirection: 'row', alignItems: 'center' },
  payDatum: { fontSize: 12, color: '#999', marginRight: 10 },
  payBadge: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },

  toppToggle: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  toppToggleBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  toppToggleActive: { backgroundColor: GREEN },
  toppToggleText: { fontSize: 14, fontWeight: '600', color: '#666' },
  toppToggleTextActive: { color: '#fff' },
  toppRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  toppRowMe: { backgroundColor: '#E8F5E9', borderRadius: 8 },
  toppRank: { width: 28, fontSize: 14, fontWeight: '700', color: '#999', textAlign: 'center' },
  toppNamn: { flex: 1, fontSize: 14, color: '#333', marginLeft: 6 },
  toppNamnMe: { fontWeight: '800', color: GREEN },
  toppSmall: { fontSize: 12, color: '#999', width: 60, textAlign: 'right' },
  toppPct: { fontSize: 15, fontWeight: '800', color: '#333', width: 52, textAlign: 'right' },
});
