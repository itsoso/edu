import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'life.executor.edu',
  appName: '学习系统',
  webDir: 'dist',
  server: {
    url: 'https://YOUR_DOMAIN',
    cleartext: false,
    allowNavigation: ['edu.executor.life'],
  },
  ios: {
    contentInset: 'always',
  },
}

export default config
