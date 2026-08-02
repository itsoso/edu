jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
jest.mock('react-native-video', () => 'Video');
jest.mock('react-native-gifted-charts', () => ({
  BarChart: 'BarChart',
  LineChart: 'LineChart',
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
  resetGenericPassword: jest.fn(async () => true),
}));

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(async () => ({ didCancel: true })),
  launchImageLibrary: jest.fn(async () => ({ didCancel: true })),
}));

jest.mock('react-native-document-picker', () => ({
  pickSingle: jest.fn(),
  isCancel: jest.fn(() => false),
  types: { doc: 'doc', docx: 'docx' },
}));

jest.mock('react-native-share', () => ({ open: jest.fn() }));

jest.mock('react-native-audio-recorder-player', () =>
  jest.fn().mockImplementation(() => ({
    startRecorder: jest.fn(),
    stopRecorder: jest.fn(),
    startPlayer: jest.fn(),
    stopPlayer: jest.fn(),
    addRecordBackListener: jest.fn(),
    removeRecordBackListener: jest.fn(),
    addPlayBackListener: jest.fn(),
    removePlayBackListener: jest.fn(),
  })),
);
/* eslint-env jest */
