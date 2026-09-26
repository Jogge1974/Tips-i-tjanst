import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import EkonomiScreen from '../screens/EkonomiScreen';
import MasterskapScreen from '../screens/MasterskapScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator();

export default function MerNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Ekonomi"
      screenOptions={{
        headerStyle: { backgroundColor: '#1B5E20' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen name="Ekonomi" component={EkonomiScreen} options={{ title: 'Ekonomi' }} />
      <Stack.Screen name="Masterskap" component={MasterskapScreen} options={{ title: 'Mästerskap' }} />
      <Stack.Screen name="Inställningar" component={SettingsScreen} options={{ title: 'Inställningar' }} />
    </Stack.Navigator>
  );
}
