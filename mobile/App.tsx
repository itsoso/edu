import React, { useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Platform,
  Text,
  View,
  StyleSheet,
  StatusBar,
} from 'react-native'
import { signals } from './src/lib/signals'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { AuthProvider, useAuth } from './src/lib/auth'
import { ToastProvider } from './src/components/Toast'
import LoginScreen from './src/screens/LoginScreen'
import RegisterScreen from './src/screens/RegisterScreen'
import DashboardScreen from './src/screens/DashboardScreen'
import MistakesScreen from './src/screens/MistakesScreen'
import EssaysScreen from './src/screens/EssaysScreen'
import ScanScreen from './src/screens/ScanScreen'
import MoreScreen from './src/screens/MoreScreen'
import PlanScreen from './src/screens/PlanScreen'
import TrendsScreen from './src/screens/TrendsScreen'
import PracticeScreen from './src/screens/PracticeScreen'
import JournalScreen from './src/screens/JournalScreen'
import ReportsScreen from './src/screens/ReportsScreen'
import MethodsScreen from './src/screens/MethodsScreen'
import AnalysisScreen from './src/screens/AnalysisScreen'
import SettingsScreen from './src/screens/SettingsScreen'
import InsightsScreen from './src/screens/InsightsScreen'
import FeynmanScreen from './src/screens/FeynmanScreen'
import FeynmanHistoryScreen from './src/screens/FeynmanHistoryScreen'
import FeynmanNewScreen from './src/screens/FeynmanNewScreen'
import CoachScreen from './src/screens/CoachScreen'
import ScheduleScreen from './src/screens/ScheduleScreen'
import { colors } from './src/lib/theme'

const Stack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()

function tabIcon(label: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{label}</Text>
  )
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.slate500,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: colors.divider,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={DashboardScreen}
        options={{ title: '今日', tabBarIcon: tabIcon('🏠') }}
      />
      <Tab.Screen
        name="Mistakes"
        component={MistakesScreen}
        options={{ title: '错题', tabBarIcon: tabIcon('📓') }}
      />
      <Tab.Screen
        name="Practice"
        component={PracticeScreen}
        options={{ title: '训练', tabBarIcon: tabIcon('🏋️') }}
      />
      <Tab.Screen
        name="Essays"
        component={EssaysScreen}
        options={{ title: '作文', tabBarIcon: tabIcon('✍️') }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{ title: '更多', tabBarIcon: tabIcon('⋯') }}
      />
    </Tab.Navigator>
  )
}

function Router() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    )
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen
            name="Plan"
            component={PlanScreen}
            options={{ headerShown: true, title: '周计划' }}
          />
          <Stack.Screen
            name="Trends"
            component={TrendsScreen}
            options={{ headerShown: true, title: '成绩趋势' }}
          />
          <Stack.Screen
            name="Scan"
            component={ScanScreen}
            options={{ headerShown: true, title: '扫试卷' }}
          />
          <Stack.Screen
            name="Journal"
            component={JournalScreen}
            options={{ headerShown: true, title: '日记' }}
          />
          <Stack.Screen
            name="Reports"
            component={ReportsScreen}
            options={{ headerShown: true, title: '月度复盘' }}
          />
          <Stack.Screen
            name="Insights"
            component={InsightsScreen}
            options={{ headerShown: true, title: '看见自己' }}
          />
          <Stack.Screen
            name="Methods"
            component={MethodsScreen}
            options={{ headerShown: true, title: '学习方法' }}
          />
          <Stack.Screen
            name="Analysis"
            component={AnalysisScreen}
            options={{ headerShown: true, title: 'AI 用量' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ headerShown: true, title: '设置' }}
          />
          <Stack.Screen
            name="Feynman"
            component={FeynmanScreen}
            options={{ headerShown: true, title: '你教我' }}
          />
          <Stack.Screen
            name="FeynmanHistory"
            component={FeynmanHistoryScreen}
            options={{ headerShown: true, title: '你讲过的' }}
          />
          <Stack.Screen
            name="FeynmanNew"
            component={FeynmanNewScreen}
            options={{ headerShown: true, title: '讲一个新知识点' }}
          />
          <Stack.Screen
            name="Coach"
            component={CoachScreen}
            options={{ headerShown: true, title: '周日复盘' }}
          />
          <Stack.Screen
            name="Schedule"
            component={ScheduleScreen}
            options={{ headerShown: true, title: '课程日历' }}
          />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
    </Stack.Navigator>
  )
}

function deviceModel(): string {
  // Platform.constants exists on iOS RN; degrade gracefully
  try {
    const c: any = (Platform as any).constants || {}
    const sysName = c.systemName || 'iOS'
    return `${sysName} ${Platform.Version}`
  } catch {
    return `iOS ${Platform.Version}`
  }
}

function SignalsLifecycle() {
  const appState = useRef<AppStateStatus>(AppState.currentState)

  useEffect(() => {
    let cancelled = false
    void signals.refreshSettings().then(() => {
      if (cancelled) return
      signals.startSession({
        platform: 'ios',
        version: '0.0.1',
        device_model: deviceModel(),
      })
    })

    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current
      appState.current = next
      if (
        (prev === 'active') &&
        (next === 'background' || next === 'inactive')
      ) {
        signals.endSession()
        void signals.flush()
      } else if (next === 'active' && prev !== 'active') {
        signals.startSession({
          platform: 'ios',
          version: '0.0.1',
          device_model: deviceModel(),
        })
      }
    })

    return () => {
      cancelled = true
      sub.remove()
      signals.endSession()
      void signals.flush()
    }
  }, [])

  return null
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ToastProvider>
        <AuthProvider>
          <SignalsLifecycle />
          <NavigationContainer>
            <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
            <Router />
          </NavigationContainer>
        </AuthProvider>
      </ToastProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
