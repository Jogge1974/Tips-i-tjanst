import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, API_BASE_URL } from './api';

const DEVICE_ID_KEY = '@tips_i_tjanst_device_id';

// Generate an RFC4122-ish random id (no external uuid dependency needed)
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// A stable per-installation id so each device keeps its own notification settings
export async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function getDeviceName(): string {
  return Device.deviceName || Device.modelName || Platform.OS;
}

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
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
    const deviceId = await getDeviceId();
    await fetch(`${API_BASE_URL}?action=registerPushToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        pushToken,
        platform: Platform.OS,
        deviceId,
        deviceName: getDeviceName(),
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
    const deviceId = await getDeviceId();
    const response = await fetch(
      `${API_BASE_URL}?action=getPushSettings&userId=${userId}&deviceId=${encodeURIComponent(deviceId)}`
    );
    return await response.json();
  } catch {
    return { notis_ny_kupong: 1, notis_spelstopp: 1, notis_live: 1, notis_meddelande: 1 };
  }
}

export async function updatePushSettings(userId: number, settings: PushSettings): Promise<void> {
  const deviceId = await getDeviceId();
  await fetch(`${API_BASE_URL}?action=updatePushSettings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, deviceId, ...settings }),
  });
}
