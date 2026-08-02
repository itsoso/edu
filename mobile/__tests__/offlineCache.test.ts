import AsyncStorage from '@react-native-async-storage/async-storage';
import {beforeEach, describe, expect, it} from '@jest/globals';
import {ApiError} from '../src/lib/api';
import {
  cachedFetch,
  readCache,
  setCacheOwner,
  writeCache,
} from '../src/lib/offlineCache';

describe('offline cache isolation', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setCacheOwner(null);
  });

  it('never exposes one account cache to another account', async () => {
    setCacheOwner(1);
    await writeCache('mistakes:list', [{question_text: 'Alice secret'}]);

    setCacheOwner(2);
    expect(await readCache('mistakes:list')).toBeNull();

    setCacheOwner(1);
    expect(await readCache('mistakes:list')).toEqual([
      {question_text: 'Alice secret'},
    ]);
  });

  it('does not fall back to stale cache for authenticated HTTP errors', async () => {
    setCacheOwner(1);
    await writeCache('essays:list', [{content: 'private essay'}]);

    await expect(
      cachedFetch('essays:list', async () => {
        throw new ApiError(401, 'unauthorized');
      }),
    ).rejects.toMatchObject({status: 401});
  });
});
