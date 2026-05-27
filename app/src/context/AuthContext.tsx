import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../services/api';
import { registerForPushNotifications } from '../services/pushNotifications';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (user: User, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

const STORAGE_KEY = '@tips_i_tjanst_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStoredUser();
  }, []);

  const loadStoredUser = async () => {
    try {
      const storedUser = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
        registerForPushNotifications(parsed.id).catch((e) => {
          console.warn('Push registration failed:', e);
        });
      }
    } catch (error) {
      console.error('Kunde inte ladda sparad användare:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (userData: User, rememberMe: boolean) => {
    setUser(userData);
    if (rememberMe) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    }
    registerForPushNotifications(userData.id).catch((e) => {
      console.warn('Push registration failed:', e);
    });
  };

  const logout = async () => {
    setUser(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
