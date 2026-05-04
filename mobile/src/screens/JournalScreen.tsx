/**
 * JournalScreen — React Native 版日记页.
 *
 * 三种输入模式: 文字 (free_write) + 录音 + 视频.
 * 隐私边界:
 *   - 文字永远不被 AI 分析.
 *   - 音视频默认不分析, 用户可以显式 opt-in.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Modal,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AudioRecorderPlayer from 'react-native-audio-recorder-player'
import { launchCamera, launchImageLibrary } from 'react-native-image-picker'
import Video from 'react-native-video'
import { api, Reflection, JournalMedia, loadToken } from '../lib/api'
import { signals } from '../lib/signals'
import { API_BASE_URL } from '../lib/config'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

// v3.x: 需要实例化. 模块级单例足够 (整个 app 只会有一个录音/播放在进行).
const arp: any = new (AudioRecorderPlayer as any)()

const MAX_CHARS = 2000
const PREVIEW_CHARS = 200

// ---- 共享工具 ----
function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatMMSS(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

// ---- AudioRecorder ----
type AudioLocal = { uri: string; durationSecs: number } | null

function AudioRecorderCard({
  onUploaded,
}: {
  onUploaded: () => void
}) {
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [local, setLocal] = useState<AudioLocal>(null)
  const [playing, setPlaying] = useState(false)
  const [playPos, setPlayPos] = useState(0)
  const [playDur, setPlayDur] = useState(0)
  const [uploading, setUploading] = useState(false)

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      try {
        arp.removeRecordBackListener()
      } catch {}
      try {
        arp.removePlayBackListener()
      } catch {}
      try {
        arp.stopRecorder()
      } catch {}
      try {
        arp.stopPlayer()
      } catch {}
    }
  }, [])

  async function startRecord() {
    try {
      // 传 undefined 让原生模块自动分配一个 tmp 路径
      const uri = await arp.startRecorder(undefined)
      arp.addRecordBackListener((e: any) => {
        setElapsedMs(e.currentPosition || 0)
      })
      setRecording(true)
      setElapsedMs(0)
      setLocal({ uri, durationSecs: 0 })
    } catch (e: any) {
      Alert.alert('无法开始录音', String(e?.message || e))
    }
  }

  async function stopRecord() {
    try {
      const uri = await arp.stopRecorder()
      arp.removeRecordBackListener()
      const dur = Math.round(elapsedMs / 1000)
      setRecording(false)
      setLocal({ uri, durationSecs: dur })
    } catch (e: any) {
      Alert.alert('停止录音失败', String(e?.message || e))
    }
  }

  async function togglePlay() {
    if (!local) return
    if (playing) {
      try {
        await arp.stopPlayer()
        arp.removePlayBackListener()
      } catch {}
      setPlaying(false)
      setPlayPos(0)
      return
    }
    try {
      await arp.startPlayer(local.uri)
      arp.addPlayBackListener((e: any) => {
        setPlayPos(e.currentPosition || 0)
        setPlayDur(e.duration || 0)
        if (
          e.duration > 0 &&
          e.currentPosition >= e.duration
        ) {
          arp.stopPlayer().catch(() => {})
          arp.removePlayBackListener()
          setPlaying(false)
          setPlayPos(0)
        }
      })
      setPlaying(true)
    } catch (e: any) {
      Alert.alert('播放失败', String(e?.message || e))
    }
  }

  function discardLocal() {
    arp.stopPlayer().catch(() => {})
    arp.removePlayBackListener()
    setPlaying(false)
    setPlayPos(0)
    setPlayDur(0)
    setLocal(null)
    setElapsedMs(0)
  }

  async function upload() {
    if (!local) return
    setUploading(true)
    try {
      // iOS 的 uri 可能像 file:///.../sound.m4a
      const uri = local.uri
      const fileName = `audio_${Date.now()}.m4a`
      await api.uploadJournalMedia(uri, fileName, 'audio/m4a', 'audio', {
        durationSecs: local.durationSecs || undefined,
      })
      discardLocal()
      onUploaded()
    } catch (e: any) {
      Alert.alert('上传失败', String(e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <View style={styles.inputCard}>
      <Text style={styles.inputLabel}>录一段语音</Text>

      {/* 大按钮 */}
      {!local && (
        <View style={styles.recordRow}>
          <Pressable
            onPress={recording ? stopRecord : startRecord}
            style={[
              styles.bigMicBtn,
              recording && styles.bigMicBtnActive,
            ]}
          >
            <Text style={styles.bigMicIcon}>
              {recording ? '■' : '🎙️'}
            </Text>
          </Pressable>
          <View style={{ marginLeft: 16 }}>
            <Text style={styles.recordTime}>
              {formatMMSS(elapsedMs / 1000)}
            </Text>
            <Text style={styles.recordHint}>
              {recording ? '录音中, 点击停止' : '点击大按钮开始录音'}
            </Text>
          </View>
        </View>
      )}

      {/* 本地预览 */}
      {local && (
        <View>
          <View style={styles.localPreviewRow}>
            <Pressable onPress={togglePlay} style={styles.playBtn}>
              <Text style={styles.playBtnText}>
                {playing ? '❚❚' : '▶'}
              </Text>
            </Pressable>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.recordTime}>
                {playing && playDur > 0
                  ? `${formatMMSS(playPos / 1000)} / ${formatMMSS(
                      playDur / 1000
                    )}`
                  : formatMMSS(local.durationSecs)}
              </Text>
              <Text style={styles.recordHint}>本地预览, 尚未上传</Text>
            </View>
          </View>

          <View style={styles.previewActions}>
            <Pressable
              onPress={upload}
              disabled={uploading}
              style={[
                styles.saveBtn,
                uploading && styles.saveBtnDisabled,
              ]}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>上传</Text>
              )}
            </Pressable>
            <Pressable onPress={discardLocal} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>删除</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

// ---- VideoRecorder ----
type VideoLocal = {
  uri: string
  fileName: string
  mime: string
  durationSecs: number
} | null

function VideoRecorderCard({ onUploaded }: { onUploaded: () => void }) {
  const [local, setLocal] = useState<VideoLocal>(null)
  const [uploading, setUploading] = useState(false)

  async function pick(source: 'camera' | 'library') {
    try {
      const fn = source === 'camera' ? launchCamera : launchImageLibrary
      const res = await fn({
        mediaType: 'video',
        videoQuality: 'medium',
        durationLimit: 60,
        selectionLimit: 1,
      })
      if (res.didCancel) return
      if (res.errorCode) {
        Alert.alert('选取失败', res.errorMessage || res.errorCode)
        return
      }
      const asset = res.assets?.[0]
      if (!asset?.uri) return
      setLocal({
        uri: asset.uri,
        fileName: asset.fileName || `video_${Date.now()}.mp4`,
        mime: asset.type || 'video/mp4',
        durationSecs: Math.round(asset.duration || 0),
      })
    } catch (e: any) {
      Alert.alert('无法打开', String(e?.message || e))
    }
  }

  async function upload() {
    if (!local) return
    setUploading(true)
    try {
      await api.uploadJournalMedia(
        local.uri,
        local.fileName,
        local.mime || 'video/mp4',
        'video',
        { durationSecs: local.durationSecs || undefined }
      )
      setLocal(null)
      onUploaded()
    } catch (e: any) {
      Alert.alert('上传失败', String(e?.message || e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <View style={styles.inputCard}>
      <Text style={styles.inputLabel}>录一段视频</Text>

      {!local && (
        <View style={styles.videoPickRow}>
          <Pressable
            onPress={() => pick('camera')}
            style={styles.pickBtn}
          >
            <Text style={styles.pickBtnIcon}>📹</Text>
            <Text style={styles.pickBtnText}>拍视频</Text>
          </Pressable>
          <Pressable
            onPress={() => pick('library')}
            style={styles.pickBtn}
          >
            <Text style={styles.pickBtnIcon}>🖼️</Text>
            <Text style={styles.pickBtnText}>从相册选</Text>
          </Pressable>
        </View>
      )}

      {local && (
        <View>
          <Video
            source={{ uri: local.uri }}
            style={styles.localVideoPreview}
            controls
            resizeMode="contain"
            paused
          />
          <Text style={styles.recordHint}>
            {local.fileName} · {formatMMSS(local.durationSecs)}
          </Text>
          <View style={styles.previewActions}>
            <Pressable
              onPress={upload}
              disabled={uploading}
              style={[
                styles.saveBtn,
                uploading && styles.saveBtnDisabled,
              ]}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>上传</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setLocal(null)}
              style={styles.ghostBtn}
            >
              <Text style={styles.ghostBtnText}>删除</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

// ---- Journal media item (inline player + delete + AI analyze opt-in) ----
function JournalMediaItem({
  media,
  token,
  onDelete,
  onUpdated,
  onAskAnalyze,
}: {
  media: JournalMedia
  token: string | null
  onDelete: (id: number) => void
  onUpdated: (m: JournalMedia) => void
  onAskAnalyze: (m: JournalMedia) => void
}) {
  const [m, setM] = useState(media)
  useEffect(() => setM(media), [media])

  const [videoOpen, setVideoOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playPos, setPlayPos] = useState(0)
  const [playDur, setPlayDur] = useState(0)

  const isProcessing =
    m.analysis_status === 'extracting_frames' ||
    m.analysis_status === 'analyzing'

  // 轮询分析状态 (仅处理中)
  useEffect(() => {
    if (!isProcessing) return
    let stopped = false
    const timer = setInterval(async () => {
      try {
        const u = await api.getJournalMedia(m.id)
        if (stopped) return
        setM(u)
        if (
          u.analysis_status !== 'extracting_frames' &&
          u.analysis_status !== 'analyzing'
        ) {
          onUpdated(u)
          clearInterval(timer)
        }
      } catch {
        /* ignore */
      }
    }, 3000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [isProcessing, m.id, onUpdated])

  const fullUrl = m.file_url.startsWith('http')
    ? m.file_url
    : API_BASE_URL + m.file_url

  async function toggleAudioPlay() {
    if (playing) {
      try {
        await arp.stopPlayer()
        arp.removePlayBackListener()
      } catch {}
      setPlaying(false)
      setPlayPos(0)
      return
    }
    try {
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      await arp.startPlayer(fullUrl, headers)
      arp.addPlayBackListener((e: any) => {
        setPlayPos(e.currentPosition || 0)
        setPlayDur(e.duration || 0)
        if (e.duration > 0 && e.currentPosition >= e.duration) {
          arp.stopPlayer().catch(() => {})
          arp.removePlayBackListener()
          setPlaying(false)
          setPlayPos(0)
        }
      })
      setPlaying(true)
    } catch (e: any) {
      Alert.alert('播放失败', String(e?.message || e))
    }
  }

  useEffect(() => {
    return () => {
      if (playing) {
        arp.stopPlayer().catch(() => {})
        arp.removePlayBackListener()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const progress =
    playDur > 0 ? Math.min(1, playPos / playDur) : 0

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.mediaIcon}>
          {m.media_type === 'audio' ? '🎙️' : '📹'}
        </Text>
        <Text style={styles.cardTime}>
          {formatDateTime(m.created_at)}
        </Text>
        <Pressable
          hitSlop={8}
          onPress={() => onDelete(m.id)}
          style={{ marginLeft: 'auto' }}
        >
          <Text style={styles.deleteLink}>删除</Text>
        </Pressable>
      </View>

      <Text style={styles.cardContent} numberOfLines={1}>
        {m.file_name || '(未命名文件)'}
      </Text>
      {m.duration_secs != null && (
        <Text style={styles.mediaMeta}>
          时长 {formatMMSS(m.duration_secs)}
        </Text>
      )}

      {/* Audio 内联播放 */}
      {m.media_type === 'audio' && (
        <View style={styles.inlinePlayerRow}>
          <Pressable onPress={toggleAudioPlay} style={styles.playBtnSm}>
            <Text style={styles.playBtnText}>{playing ? '❚❚' : '▶'}</Text>
          </Pressable>
          <View style={styles.progressWrap}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%` },
              ]}
            />
          </View>
          <Text style={styles.progressTime}>
            {playing && playDur > 0
              ? formatMMSS(playPos / 1000)
              : formatMMSS(m.duration_secs || 0)}
          </Text>
        </View>
      )}

      {/* Video 展开播放 */}
      {m.media_type === 'video' && (
        <View>
          {!videoOpen ? (
            <Pressable
              onPress={() => setVideoOpen(true)}
              style={styles.videoOpenBtn}
            >
              <Text style={styles.videoOpenText}>▶ 播放视频</Text>
            </Pressable>
          ) : (
            <View>
              <Video
                source={{
                  uri: fullUrl,
                  headers: token
                    ? { Authorization: `Bearer ${token}` }
                    : undefined,
                }}
                style={styles.inlineVideo}
                controls
                resizeMode="contain"
                paused={false}
              />
              <Pressable
                onPress={() => setVideoOpen(false)}
                style={styles.videoCloseBtn}
              >
                <Text style={styles.videoCloseText}>收起</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {/* AI 分析 opt-in */}
      <View style={styles.aiOptRow}>
        {m.analysis_status === 'done' && m.analysis && (
          <View style={styles.aiResultBox}>
            {m.analysis_prompt && (
              <Text style={styles.aiPrompt}>
                提问: {m.analysis_prompt}
              </Text>
            )}
            {m.analysis.summary && (
              <Text style={styles.aiSummary}>{m.analysis.summary}</Text>
            )}
            {m.analysis.answer && (
              <Text style={styles.aiAnswer}>{m.analysis.answer}</Text>
            )}
          </View>
        )}

        {isProcessing && (
          <Text style={styles.aiStatus}>
            {m.analysis_status === 'extracting_frames'
              ? '提取关键帧中...'
              : 'AI 分析中...'}
          </Text>
        )}

        {m.analysis_status === 'failed' && (
          <Text style={styles.aiFailed}>
            分析失败: {m.error_message || '未知错误'}
          </Text>
        )}

        {!isProcessing && (
          <Pressable onPress={() => onAskAnalyze(m)} hitSlop={6}>
            <Text style={styles.aiLink}>
              {m.analysis_status === 'done'
                ? '重新让 AI 分析 (可选)'
                : '让 AI 听听看 (可选)'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

// ---- Main screen ----
export default function JournalScreen() {
  const { hPadding, maxContent } = useResponsive()
  const [reflections, setReflections] = useState<Reflection[]>([])
  const [media, setMedia] = useState<JournalMedia[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [content, setContent] = useState('')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [error, setError] = useState('')
  const [token, setToken] = useState<string | null>(null)

  // AI 分析 modal
  const [aiTarget, setAiTarget] = useState<JournalMedia | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiSubmitting, setAiSubmitting] = useState(false)

  // 初次加载 token (给 video headers 用)
  useEffect(() => {
    loadToken().then(setToken).catch(() => setToken(null))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [refs, meds] = await Promise.all([
        api.listReflections({ kind: 'free_write', limit: 100 }),
        api.listJournalMedia(),
      ])
      refs.sort((a, b) => b.created_at.localeCompare(a.created_at))
      meds.sort((a, b) => b.created_at.localeCompare(a.created_at))
      setReflections(refs)
      setMedia(meds)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function submit() {
    const trimmed = content.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await api.upsertReflection({ kind: 'free_write', content: trimmed })
      signals.track('journal.write', {
        related_table: 'reflections',
        payload: { char_count: trimmed.length },
      })
      setContent('')
      await load()
    } catch (e: any) {
      Alert.alert('保存失败', String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  function confirmDeleteReflection(id: number) {
    Alert.alert('删除这条?', '不可恢复', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteReflection(id)
            setReflections((prev) => prev.filter((r) => r.id !== id))
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  function confirmDeleteMedia(id: number) {
    Alert.alert('删除这段录制?', '不可恢复', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteJournalMedia(id)
            setMedia((prev) => prev.filter((m) => m.id !== id))
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  function handleMediaUpdated(updated: JournalMedia) {
    setMedia((prev) =>
      prev.map((m) => (m.id === updated.id ? updated : m))
    )
  }

  function openAnalyzeModal(m: JournalMedia) {
    setAiTarget(m)
    setAiPrompt(m.analysis_prompt || '')
  }

  async function submitAnalyze() {
    if (!aiTarget) return
    const p = aiPrompt.trim()
    if (!p) {
      Alert.alert('请输入想问 AI 的内容')
      return
    }
    setAiSubmitting(true)
    try {
      const updated = await api.analyzeJournalMedia(aiTarget.id, p)
      handleMediaUpdated(updated)
      setAiTarget(null)
      setAiPrompt('')
    } catch (e: any) {
      Alert.alert('分析请求失败', String(e?.message || e))
    } finally {
      setAiSubmitting(false)
    }
  }

  const contentStyle = [
    styles.listContent,
    { paddingHorizontal: hPadding },
    maxContent ? { maxWidth: maxContent, alignSelf: 'center' as const, width: '100%' as const } : null,
  ]

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={contentStyle}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero */}
        <Text style={styles.heroTitle}>
          你的日记。不会被 AI 分析。永远。
        </Text>
        <Text style={styles.heroSub}>
          文字永远不被 AI 分析 · 音视频可选 AI 分析 · 只有你自己看得到
        </Text>

        {/* 文字输入 */}
        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>写一段</Text>
          <TextInput
            value={content}
            onChangeText={(t) =>
              setContent(t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t)
            }
            placeholder="一句话、一段话、一个吐槽、一个困惑, 都可以."
            placeholderTextColor={colors.slate400}
            multiline
            textAlignVertical="top"
            style={styles.textarea}
          />
          <View style={styles.inputFooter}>
            <Text style={styles.counter}>
              {content.length} / {MAX_CHARS}
            </Text>
            <Pressable
              onPress={submit}
              disabled={saving || !content.trim()}
              style={[
                styles.saveBtn,
                (saving || !content.trim()) && styles.saveBtnDisabled,
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>保存</Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* 录音卡 */}
        <AudioRecorderCard onUploaded={load} />

        {/* 视频卡 */}
        <VideoRecorderCard onUploaded={load} />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* 文字列表 */}
        <Text style={styles.sectionHeader}>你的文字</Text>
        {reflections.length === 0 ? (
          <Text style={styles.emptyText}>
            还没有文字. 上面写一段吧.
          </Text>
        ) : (
          reflections.map((r) => {
            const isOpen = !!expanded[r.id]
            const preview =
              r.content.length > PREVIEW_CHARS
                ? r.content.slice(0, PREVIEW_CHARS) + '…'
                : r.content
            return (
              <Pressable
                key={`r-${r.id}`}
                onPress={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [r.id]: !prev[r.id],
                  }))
                }
                onLongPress={() => confirmDeleteReflection(r.id)}
                style={styles.card}
              >
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTime}>
                    {formatDateTime(r.created_at)}
                  </Text>
                  <Pressable
                    hitSlop={8}
                    onPress={() => confirmDeleteReflection(r.id)}
                    style={{ marginLeft: 'auto' }}
                  >
                    <Text style={styles.deleteLink}>删除</Text>
                  </Pressable>
                </View>
                <Text style={styles.cardContent}>
                  {isOpen ? r.content : preview}
                </Text>
                {r.content.length > PREVIEW_CHARS && (
                  <Text style={styles.expandHint}>
                    {isOpen ? '点此收起' : '点此展开'}
                  </Text>
                )}
              </Pressable>
            )
          })
        )}

        {/* 媒体列表 */}
        <Text style={styles.sectionHeader}>已有的录音 / 视频</Text>
        {media.length === 0 ? (
          <Text style={styles.emptyText}>暂无音视频.</Text>
        ) : (
          media.map((m) => (
            <JournalMediaItem
              key={`m-${m.id}`}
              media={m}
              token={token}
              onDelete={confirmDeleteMedia}
              onUpdated={handleMediaUpdated}
              onAskAnalyze={openAnalyzeModal}
            />
          ))
        )}

        <Text style={styles.footer}>
          长按文字条目也可以删除 · 文字永远不被 AI 分析
        </Text>
      </ScrollView>

      {/* AI 分析 modal */}
      <Modal
        visible={!!aiTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setAiTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>让 AI 听 / 看一下</Text>
            <Text style={styles.modalHint}>
              这是自愿的. 只有你点"分析"才会把这段
              {aiTarget?.media_type === 'audio' ? '录音' : '视频'}
              发给 AI.
            </Text>
            <TextInput
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="你想让 AI 做什么? 比如: 总结这段内容 / 辨认黑板上的题目"
              placeholderTextColor={colors.slate400}
              multiline
              style={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setAiTarget(null)}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnText}>取消</Text>
              </Pressable>
              <Pressable
                onPress={submitAnalyze}
                disabled={aiSubmitting}
                style={[
                  styles.saveBtn,
                  aiSubmitting && styles.saveBtnDisabled,
                ]}
              >
                {aiSubmitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>分析</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ---- Styles ----
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: 16, paddingBottom: 48 },

  heroTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.slate900,
    lineHeight: 30,
  },
  heroSub: {
    fontSize: 13,
    color: colors.slate500,
    marginTop: 6,
    marginBottom: 16,
  },

  inputCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.slate700,
    marginBottom: 8,
  },
  textarea: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: colors.slate900,
    backgroundColor: '#fff',
  },
  inputFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  counter: { fontSize: 12, color: colors.slate400 },
  saveBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 76,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  ghostBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: '#fff',
    alignItems: 'center',
    marginRight: 8,
  },
  ghostBtnText: { color: colors.slate700, fontSize: 14 },

  // 录音
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  bigMicBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#fef2f2',
    borderWidth: 2,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigMicBtnActive: {
    backgroundColor: '#dc2626',
    borderColor: '#b91c1c',
  },
  bigMicIcon: { fontSize: 34, color: '#fff' },
  recordTime: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.slate800,
    fontVariant: ['tabular-nums'],
  },
  recordHint: { fontSize: 12, color: colors.slate500, marginTop: 2 },

  localPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnSm: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  previewActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    alignItems: 'center',
  },

  // 视频
  videoPickRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  pickBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  pickBtnIcon: { fontSize: 28 },
  pickBtnText: {
    fontSize: 13,
    color: colors.slate700,
    marginTop: 4,
    fontWeight: '500',
  },
  localVideoPreview: {
    width: '100%',
    height: 220,
    backgroundColor: '#000',
    borderRadius: 8,
    marginTop: 4,
  },

  // 列表区
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.slate700,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: colors.slate500,
    paddingVertical: 16,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  mediaIcon: { fontSize: 16 },
  cardTime: { fontSize: 11, color: colors.slate400 },
  deleteLink: { fontSize: 12, color: colors.red500 },
  cardContent: {
    fontSize: 14,
    color: colors.slate800,
    lineHeight: 20,
  },
  expandHint: {
    fontSize: 11,
    color: colors.brand,
    marginTop: 6,
  },
  mediaMeta: { fontSize: 11, color: colors.slate400, marginTop: 4 },

  inlinePlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 10,
  },
  progressWrap: {
    flex: 1,
    height: 6,
    backgroundColor: colors.divider,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.brand,
  },
  progressTime: {
    fontSize: 11,
    color: colors.slate500,
    minWidth: 42,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },

  videoOpenBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.brandLight,
    alignItems: 'center',
  },
  videoOpenText: { color: colors.brand, fontSize: 13, fontWeight: '600' },
  inlineVideo: {
    width: '100%',
    height: 240,
    backgroundColor: '#000',
    borderRadius: 8,
    marginTop: 10,
  },
  videoCloseBtn: {
    alignSelf: 'flex-end',
    padding: 6,
    marginTop: 4,
  },
  videoCloseText: { color: colors.slate500, fontSize: 12 },

  // AI 分析
  aiOptRow: { marginTop: 10 },
  aiLink: {
    fontSize: 12,
    color: '#7c3aed',
    marginTop: 6,
  },
  aiStatus: {
    fontSize: 12,
    color: '#7c3aed',
    marginTop: 6,
    fontStyle: 'italic',
  },
  aiFailed: {
    fontSize: 12,
    color: colors.red500,
    marginTop: 6,
  },
  aiResultBox: {
    backgroundColor: '#faf5ff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  aiPrompt: {
    fontSize: 11,
    color: '#7c3aed',
    marginBottom: 4,
  },
  aiSummary: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.slate800,
    marginBottom: 2,
  },
  aiAnswer: {
    fontSize: 13,
    color: colors.slate700,
    lineHeight: 19,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.slate900,
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 12,
    color: colors.slate500,
    marginBottom: 12,
    lineHeight: 18,
  },
  modalInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: colors.slate900,
    backgroundColor: '#fff',
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    alignItems: 'center',
  },

  errorText: {
    color: colors.red500,
    fontSize: 13,
    marginVertical: 8,
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    color: colors.slate400,
    fontSize: 11,
    marginTop: 24,
  },
})

// 保留一个 Platform 引用避免未使用 (某些平台调试可能需要)
void Platform
