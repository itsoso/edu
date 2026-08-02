/**
 * 离线缓存 — 关键列表数据本地化, 网络故障时自动回退到缓存.
 *
 * 设计:
 *  - cached(key, fn): 先返回缓存(若存在), 再后台拉真数据 + 写缓存. 总返回真数据 (或缓存 fallback).
 *  - 仅缓存"列表型"数据 (错题列表/作文列表), 详情/媒体不在此处理.
 *  - 用 AsyncStorage; 单 key 上限 ~1MB 不拆.
 *
 * 用法:
 *    const data = await cachedFetch('mistakes:list', () => api.listMistakes(...))
 *
 * 离线侦测:
 *  - 直接 catch network error, 回退到缓存.
 *  - 不需要 NetInfo, 因为 API 失败本身就足以触发回退.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError } from './api'

const KEY_PREFIX = 'cache:'
const MAX_AGE_MS = 7 * 24 * 3600 * 1000  // 缓存最长 7 天有效
let cacheOwnerId: number | null = null

type CacheEntry<T> = {
  v: T
  t: number   // 时间戳 (ms)
}

export function setCacheOwner(ownerId: number | null): void {
  cacheOwnerId = ownerId
}

function scopedKey(key: string): string | null {
  if (cacheOwnerId === null) return null
  return `${KEY_PREFIX}${cacheOwnerId}:${key}`
}

export async function readCache<T>(key: string): Promise<T | null> {
  const storageKey = scopedKey(key)
  if (!storageKey) return null
  try {
    const raw = await AsyncStorage.getItem(storageKey)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (Date.now() - entry.t > MAX_AGE_MS) {
      await AsyncStorage.removeItem(storageKey)
      return null
    }
    return entry.v
  } catch (error) {
    console.warn('Failed to read offline cache', error)
    return null
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const storageKey = scopedKey(key)
  if (!storageKey) return
  try {
    const entry: CacheEntry<T> = { v: value, t: Date.now() }
    await AsyncStorage.setItem(storageKey, JSON.stringify(entry))
  } catch (error) {
    console.warn('Failed to write offline cache', error)
  }
}

/**
 * cachedFetch: 网络优先, 失败回退缓存.
 *
 * @param key 缓存 key (建议形如 'mistakes:list:subject=数学' )
 * @param fetcher 实际拉数据的函数
 * @returns { data, fromCache } — fromCache=true 表示这次走的是离线缓存
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<{ data: T; fromCache: boolean }> {
  try {
    const data = await fetcher()
    // 异步写缓存, 不阻塞返回
    writeCache(key, data)
    return { data, fromCache: false }
  } catch (e) {
    // HTTP/auth failures are authoritative and must never expose stale data.
    if (e instanceof ApiError || !(e instanceof TypeError)) throw e
    const cached = await readCache<T>(key)
    if (cached !== null) {
      return { data: cached, fromCache: true }
    }
    throw e
  }
}

/** 清除某 key 的缓存 (用户手动登出时调用) */
export async function clearCache(key?: string): Promise<void> {
  if (cacheOwnerId === null) return
  const ownerPrefix = `${KEY_PREFIX}${cacheOwnerId}:`
  if (key) {
    await AsyncStorage.removeItem(ownerPrefix + key)
  } else {
    const keys = await AsyncStorage.getAllKeys()
    const ours = keys.filter((k) => k.startsWith(ownerPrefix))
    if (ours.length) await AsyncStorage.removeMany(ours)
  }
}
