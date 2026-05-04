import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

export default function LoginScreen({ navigation }: any) {
  const { login } = useAuth()
  const { hPadding, maxContent } = useResponsive()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!username.trim() || !password) {
      Alert.alert('请填写用户名和密码')
      return
    }
    setBusy(true)
    try {
      await login(username.trim().toLowerCase(), password)
    } catch (e: any) {
      const msg = String(e.message || e)
      Alert.alert(
        '登录失败',
        msg.includes('invalid_credentials') ? '用户名或密码错误' : msg
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}>
          <View style={[styles.card, maxContent ? { maxWidth: 480, alignSelf: 'center', width: '100%' } : null]}>
            <Text style={styles.title}>学习系统</Text>
            <Text style={styles.subtitle}>学生 / 家长 登录</Text>

            <View style={styles.field}>
              <Text style={styles.label}>用户名</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="例如 demo"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>密码</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="≥ 6 位"
                placeholderTextColor="#94a3b8"
                secureTextEntry
                autoComplete="password"
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && { opacity: 0.85 },
                busy && { opacity: 0.5 },
              ]}
              onPress={submit}
              disabled={busy}
            >
              <Text style={styles.primaryButtonText}>
                {busy ? '登录中...' : '登录'}
              </Text>
            </Pressable>

            <Pressable onPress={() => navigation.navigate('Register')}>
              <Text style={styles.secondaryLink}>还没有账号? 去注册 →</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.brand,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.slate500,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
  },
  field: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.slate700,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.slate900,
  },
  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryLink: {
    textAlign: 'center',
    color: colors.brand,
    marginTop: 16,
    fontSize: 14,
  },
})
