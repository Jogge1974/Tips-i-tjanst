import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function AdminScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>⚙️</Text>
        <Text style={styles.headerTitle}>Admin</Text>
        <Text style={styles.headerSub}>Hantera Tips(i)tjänst</Text>
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
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  headerIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1B5E20',
  },
  headerSub: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
});
