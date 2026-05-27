import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api, User } from '../services/api';

export default function LoginScreen() {
  const { login } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      console.log('Hämtar användare från:', require('../services/api').API_BASE_URL);
      const fetchedUsers = await api.getUsers();
      console.log('Hämtade användare:', fetchedUsers.length);
      setUsers(fetchedUsers);
      if (fetchedUsers.length > 0) {
        setSelectedUserId(fetchedUsers[0].id);
      }
    } catch (error: any) {
      console.error('Fel vid hämtning av användare:', error);
      Alert.alert('Fel', `Kunde inte hämta användarlistan: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!selectedUserId) {
      Alert.alert('Fel', 'Välj en användare');
      return;
    }
    if (!password.trim()) {
      Alert.alert('Fel', 'Ange lösenord');
      return;
    }

    setIsLoggingIn(true);
    try {
      const result = await api.login(selectedUserId, password);
      if (result.success && result.user) {
        await login(result.user, rememberMe);
      } else {
        Alert.alert('Fel', result.error || 'Fel lösenord');
      }
    } catch (error) {
      Alert.alert('Fel', 'Inloggning misslyckades. Försök igen.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1B5E20" />
        <Text style={styles.loadingText}>Laddar...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Tips(i)tjänst</Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.label}>Välj användare</Text>
          <TouchableOpacity
            style={styles.dropdownButton}
            onPress={() => setShowDropdown(true)}
          >
            <Text style={styles.dropdownButtonText}>
              {selectedUserId
                ? `${users.find(u => u.id === selectedUserId)?.fornamn} ${users.find(u => u.id === selectedUserId)?.efternamn}`
                : 'Välj användare...'}
            </Text>
            <Text style={styles.dropdownArrow}>▼</Text>
          </TouchableOpacity>

          <Modal visible={showDropdown} transparent animationType="fade">
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setShowDropdown(false)}
            >
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Välj användare</Text>
                <FlatList
                  data={users}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.modalItem,
                        item.id === selectedUserId && styles.modalItemSelected,
                      ]}
                      onPress={() => {
                        setSelectedUserId(item.id);
                        setShowDropdown(false);
                      }}
                    >
                      <Text style={[
                        styles.modalItemText,
                        item.id === selectedUserId && styles.modalItemTextSelected,
                      ]}>
                        {item.fornamn} {item.efternamn}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            </TouchableOpacity>
          </Modal>

          <Text style={styles.label}>Lösenord</Text>
          <TextInput
            style={styles.input}
            placeholder="Ange lösenord"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
          />

          <View style={styles.rememberContainer}>
            <Switch
              value={rememberMe}
              onValueChange={setRememberMe}
              trackColor={{ false: '#ccc', true: '#81C784' }}
              thumbColor={rememberMe ? '#1B5E20' : '#f4f3f4'}
            />
            <Text style={styles.rememberText}>Kom ihåg mig</Text>
          </View>

          <TouchableOpacity
            style={[styles.loginButton, isLoggingIn && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>Logga in</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 180,
    height: 180,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1B5E20',
    marginTop: 12,
  },
  formContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
    marginTop: 12,
  },
  dropdownButton: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    backgroundColor: '#FAFAFA',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownButtonText: {
    fontSize: 16,
    color: '#333',
  },
  dropdownArrow: {
    fontSize: 12,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 30,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1B5E20',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalItemSelected: {
    backgroundColor: '#E8F5E9',
  },
  modalItemText: {
    fontSize: 16,
    color: '#333',
  },
  modalItemTextSelected: {
    color: '#1B5E20',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
  },
  rememberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  rememberText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#555',
  },
  loginButton: {
    backgroundColor: '#1B5E20',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
