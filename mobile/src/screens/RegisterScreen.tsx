import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'

const STAGES = ['初一上', '初一下', '初二上', '初二下', '初三上', '初三下']

export default function RegisterScreen({ navigation }: any) {
  const { register } = useAuth()
  const [role, setRole] = useState<'student' | 'parent'>('student')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [stage, setStage] = useState('初二下')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!username.trim() || !password || !displayName.trim()) {
      Alert.alert('请填完所有必填项')
      return
    }
    if (password.length < 6) {
      Alert.alert('密码至少 6 位')
      return
    }
    if (role === 'parent' && !joinCode.trim()) {
      Alert.alert('家长需要填写孩子的绑定码')
      return
    }
    setBusy(true)
    try {
      await register({
        role,
        username: username.trim().toLowerCase(),
        password,
        display_name: displayName.trim(),
        stage: role === 'student' ? stage : undefined,
        join_code: role === 'parent' ? joinCode.trim().toUpperCase() : undefined,
      })
    } catch (e: any) {
      const msg = String(e.message || e)
      Alert.alert(
        '注册失败',
        msg.includes('username_taken')
          ? '用户名已被占用'
          : msg.includes('invalid_join_code')
          ? '绑定码无效'
          : msg
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
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <Text style={styles.title}>注册账号</Text>

            <View style={styles.roleRow}>
              <RoleTab
                active={role === 'student'}
                onPress={() => setRole('student')}
                icon="🎓"
                label="我是学生"
              />
              <RoleTab
                active={role === 'parent'}
                onPress={() => setRole('parent')}
                icon="👨‍👩‍👧"
                label="我是家长"
              />
            </View>

            <Field label="用户名">
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder={role === 'student' ? 'zhangsan' : 'zhangsan_mom'}
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>

            <Field label="昵称">
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder={role === 'student' ? '张三' : '张三妈妈'}
                placeholderTextColor="#94a3b8"
              />
            </Field>

            <Field label="密码 (≥ 6 位)">
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </Field>

            {role === 'student' ? (
              <Field label="当前阶段">
                <View style={styles.stagesRow}>
                  {STAGES.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setStage(s)}
                      style={[
                        styles.stagePill,
                        stage === s && styles.stagePillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.stagePillText,
                          stage === s && styles.stagePillTextActive,
                        ]}
                      >
                        {s}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Field>
            ) : (
              <Field label="孩子的绑定码 (6 位)">
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={joinCode}
                  onChangeText={(t) => setJoinCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={6}
                  placeholder="QR4BEN"
                  placeholderTextColor="#94a3b8"
                />
                <Text style={styles.hint}>
                  让孩子登录后在"今日"页面查看绑定码并告诉你
                </Text>
              </Field>
            )}

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
                {busy ? '注册中...' : '注册并登录'}
              </Text>
            </Pressable>

            <Pressable onPress={() => navigation.goBack()}>
              <Text style={styles.secondaryLink}>← 已有账号? 去登录</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

function RoleTab({
  active,
  onPress,
  icon,
  label,
}: {
  active: boolean
  onPress: () => void
  icon: string
  label: string
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.roleTab, active && styles.roleTabActive]}
    >
      <Text style={styles.roleIcon}>{icon}</Text>
      <Text style={[styles.roleLabel, active && styles.roleLabelActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.brand,
    textAlign: 'center',
    marginBottom: 20,
  },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  roleTab: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  roleTabActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  roleIcon: { fontSize: 20, marginBottom: 4 },
  roleLabel: { fontSize: 14, color: colors.slate700 },
  roleLabelActive: { color: '#fff', fontWeight: '600' },

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
  codeInput: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    letterSpacing: 3,
    fontSize: 18,
    textAlign: 'center',
  },
  hint: { fontSize: 11, color: colors.slate500, marginTop: 6 },
  stagesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stagePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stagePillActive: {
    backgroundColor: colors.brandLight,
    borderColor: colors.brand,
  },
  stagePillText: { fontSize: 13, color: colors.slate700 },
  stagePillTextActive: { color: colors.brand, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryLink: {
    textAlign: 'center',
    color: colors.brand,
    marginTop: 16,
    fontSize: 14,
  },
})
