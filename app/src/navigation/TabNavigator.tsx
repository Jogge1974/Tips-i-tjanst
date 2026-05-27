import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import HomeScreen from '../screens/HomeScreen';
import MinSidaScreen from '../screens/MinSidaScreen';
import TipsAllsvenskanScreen from '../screens/TipsAllsvenskanScreen';
import LiveScreen from '../screens/LiveScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

export default function TabNavigator() {
  return (
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
          } else if (route.name === 'Inställningar') {
            iconName = focused ? 'settings' : 'settings-outline';
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
        name="Inställningar"
        component={SettingsScreen}
        options={{ title: 'Inställningar' }}
      />
    </Tab.Navigator>
  );
}
