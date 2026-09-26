import React, { useState, useRef } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen from '../screens/HomeScreen';
import MinSidaScreen from '../screens/MinSidaScreen';
import TipsAllsvenskanScreen from '../screens/TipsAllsvenskanScreen';
import LiveScreen from '../screens/LiveScreen';
import CupScreen from '../screens/CupScreen';
import MerNavigator from './MerNavigator';
import AdminTabsScreen from '../screens/AdminTabsScreen';
import { useAuth } from '../context/AuthContext';

const Tab = createBottomTabNavigator();

type MerOption = { key: string; label: string; desc: string; icon: keyof typeof Ionicons.glyphMap };

export default function TabNavigator() {
  const { user } = useAuth();
  const isAdmin = user?.id === 1;
  const [merMenuVisible, setMerMenuVisible] = useState(false);
  const merNavRef = useRef<any>(null);

  const merOptions: MerOption[] = [
    { key: 'Ekonomi', label: 'Ekonomi', desc: 'Ekonomi och statistik', icon: 'wallet-outline' },
    { key: 'Masterskap', label: 'Mästerskap', desc: 'Champions, Charity Shield & cupvinnare', icon: 'trophy-outline' },
    { key: 'Inställningar', label: 'Inställningar', desc: 'Notiser och konto', icon: 'settings-outline' },
  ];

  const openMer = (screen: string) => {
    setMerMenuVisible(false);
    merNavRef.current?.navigate('Mer', { screen });
  };

  return (
    <>
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Hem') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'MinSida') {
            iconName = focused ? 'person' : 'person-outline';
          } else if (route.name === 'TipsAllsvenskan') {
            iconName = focused ? 'trophy' : 'trophy-outline';
          } else if (route.name === 'Live') {
            iconName = focused ? 'football' : 'football-outline';
          } else if (route.name === 'Cup') {
            iconName = focused ? 'git-network' : 'git-network-outline';
          } else if (route.name === 'Mer') {
            iconName = focused ? 'ellipsis-horizontal' : 'ellipsis-horizontal-outline';
          } else if (route.name === 'Admin') {
            iconName = focused ? 'shield' : 'shield-outline';
          } else {
            iconName = 'help-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#1B5E20',
        tabBarInactiveTintColor: '#999',
        headerStyle: {
          backgroundColor: '#1B5E20',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen
        name="Hem"
        component={HomeScreen}
        options={{ title: 'Hem' }}
      />
      <Tab.Screen
        name="MinSida"
        component={MinSidaScreen}
        options={{ title: 'Min sida' }}
      />
      <Tab.Screen
        name="TipsAllsvenskan"
        component={TipsAllsvenskanScreen}
        options={{ title: 'Tabell' }}
      />
      <Tab.Screen
        name="Live"
        component={LiveScreen}
        options={{ title: 'Live' }}
      />
      <Tab.Screen
        name="Cup"
        component={CupScreen}
        options={{ title: 'Cup' }}
      />
      <Tab.Screen
        name="Mer"
        component={MerNavigator}
        options={{ title: '...', headerShown: false }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            // Öppna popup istället för att byta flik
            e.preventDefault();
            merNavRef.current = navigation;
            setMerMenuVisible(true);
          },
        })}
      />
      {isAdmin && (
        <Tab.Screen
          name="Admin"
          component={AdminTabsScreen}
          options={{ title: 'Admin', headerShown: false }}
        />
      )}
    </Tab.Navigator>

    <Modal
      visible={merMenuVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setMerMenuVisible(false)}
    >
      <Pressable style={styles.overlay} onPress={() => setMerMenuVisible(false)}>
        <Pressable style={styles.menuCard} onPress={() => {}}>
          {merOptions.map((opt) => (
            <TouchableOpacity key={opt.key} style={styles.menuRow} onPress={() => openMer(opt.key)} activeOpacity={0.7}>
              <View style={styles.menuIcon}>
                <Ionicons name={opt.icon} size={20} color="#1B5E20" />
              </View>
              <Text style={styles.menuLabel}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 6,
    marginRight: 10,
    marginBottom: 64,
    minWidth: 190,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuLabel: { fontSize: 15, fontWeight: '600', color: '#333' },
});
