import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api, API_BASE_URL } from './api';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(userId: number): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted');
    return null;
  }

  // Get Expo push token
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  const pushToken = tokenData.data;

  // Register token on server
  try {
    await fetch(`${API_BASE_URL}?action=registerPushToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        pushToken,
        platform: Platform.OS,
      }),
    });
  } catch (e) {
    console.error('Failed to register push token:', e);
  }

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Tips(i)tjänst',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  return pushToken;
}

export interface PushSettings {
  notis_ny_kupong: number;
  notis_spelstopp: number;
  notis_live: number;
  notis_meddelande: number;
}

export async function getPushSettings(userId: number): Promise<PushSettings> {
  try {
    const response = await fetch(`${API_BASE_URL}?action=getPushSettings&userId=${userId}`);
    return await response.json();
  } catch {
    return { notis_ny_kupong: 1, notis_spelstopp: 1, notis_live: 1, notis_meddelande: 1 };
  }
}

export async function updatePushSettings(userId: number, settings: PushSettings): Promise<void> {
  await fetch(`${API_BASE_URL}?action=updatePushSettings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...settings }),
  });
}
