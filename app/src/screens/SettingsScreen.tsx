import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Switch, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getPushSettings, updatePushSettings, PushSettings } from '../services/pushNotifications';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState<PushSettings>({
    notis_ny_kupong: 1,
    notis_spelstopp: 1,
    notis_live: 1,
  });

  useFocusEffect(
    useCallback(() => {
      if (user) {
        getPushSettings(user.id).then(setSettings).catch(() => {});
      }
    }, [user])
  );

  const toggleSetting = async (key: keyof PushSettings) => {
    const newSettings = { ...settings, [key]: settings[key] ? 0 : 1 };
    setSettings(newSettings);
    if (user) {
      await updatePushSettings(user.id, newSettings);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logga ut',
      'Är du säker på att du vill logga ut?',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Logga ut',
          style: 'destructive',
          onPress: () => logout(),
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>
          {user?.fornamn} {user?.efternamn}
        </Text>
        <Text style={styles.userType}>
          {user?.userType === 'admin' ? 'Administratör' : 'Användare'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Push-notiser</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Ny kupong</Text>
            <Text style={styles.settingDesc}>Notis när veckans match kan tippas</Text>
          </View>
          <Switch
            value={!!settings.notis_ny_kupong}
            onValueChange={() => toggleSetting('notis_ny_kupong')}
            trackColor={{ false: '#ddd', true: '#81C784' }}
            thumbColor={settings.notis_ny_kupong ? '#1B5E20' : '#999'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Spelstopp-påminnelse</Text>
            <Text style={styles.settingDesc}>Påminnelse innan spelet stänger torsdag kl 12</Text>
          </View>
          <Switch
            value={!!settings.notis_spelstopp}
            onValueChange={() => toggleSetting('notis_spelstopp')}
            trackColor={{ false: '#ddd', true: '#81C784' }}
            thumbColor={settings.notis_spelstopp ? '#1B5E20' : '#999'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Live-notiser</Text>
            <Text style={styles.settingDesc}>Start, rapporter och slutresultat från Stryktipset</Text>
          </View>
          <Switch
            value={!!settings.notis_live}
            onValueChange={() => toggleSetting('notis_live')}
            trackColor={{ false: '#ddd', true: '#81C784' }}
            thumbColor={settings.notis_live ? '#1B5E20' : '#999'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Konto</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logga ut</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.version}>Tips(i)tjänst v1.0.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  userInfo: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1B5E20',
  },
  userType: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  section: {
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  settingDesc: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  logoutButton: {
    backgroundColor: '#C62828',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  logoutText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 24,
  },
  version: {
    fontSize: 12,
    color: '#999',
  },
});
