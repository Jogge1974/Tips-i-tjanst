import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AdminScreen from './AdminScreen';
import CupAdminScreen from './CupAdminScreen';

const GREEN = '#1B5E20';

type AdminTab = 'tips' | 'cup';

export default function AdminTabsScreen() {
  const [tab, setTab] = useState<AdminTab>('tips');
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.segmentBar}>
        <TouchableOpacity
          style={[styles.segmentButton, tab === 'tips' && styles.segmentButtonActive]}
          onPress={() => setTab('tips')}
        >
          <Text style={[styles.segmentText, tab === 'tips' && styles.segmentTextActive]}>Tipsadmin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, tab === 'cup' && styles.segmentButtonActive]}
          onPress={() => setTab('cup')}
        >
          <Text style={[styles.segmentText, tab === 'cup' && styles.segmentTextActive]}>Cupadmin</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {tab === 'tips' ? <AdminScreen /> : <CupAdminScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  body: { flex: 1 },
  segmentBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 6,
    margin: 12,
    marginBottom: 0,
    borderRadius: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  segmentButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentButtonActive: { backgroundColor: GREEN },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#666' },
  segmentTextActive: { color: '#fff' },
});
