/**
 * 任务屏 — 家长布置 / 学生待办.
 * Web 版逻辑的 RN 等价实现.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  Alert,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, Assignment } from '../lib/api'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'

const KIND_OPTIONS = [
  { v: 'custom', label: '其他', emoji: '📌' },
  { v: 'practice', label: '做练习', emoji: '🏋️' },
  { v: 'essay', label: '写作文', emoji: '📝' },
  { v: 'reading', label: '阅读', emoji: '📖' },
] as const

const KIND_EMOJI: Record<string, string> = {
  custom: '📌',
  practice: '🏋️',
  essay: '📝',
  reading: '📖',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isOverdue(a: Assignment): boolean {
  if (!a.due_date || a.status !== 'pending') return false
  return a.due_date < todayIso()
}

export default function AssignmentsScreen() {
  const { user } = useAuth()
  const isParent = user?.role === 'parent'

  const [items, setItems] = useState<Assignment[]>([])
  const [filter, setFilter] = useState<'pending' | 'completed' | 'all'>('pending')
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)

  // 表单
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<string>('custom')
  const [dueDate, setDueDate] = useState('')

  const reload = useCallback(async () => {
    try {
      const data = await api.listAssignments({
        status: filter === 'all' ? undefined : filter,
        mine_assigned: !!isParent,
      })
      setItems(data)
    } catch (e: any) {
      Alert.alert('加载失败', String(e?.message || e))
    }
  }, [filter, isParent])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleAdd() {
    if (!title.trim()) {
      Alert.alert('请填标题')
      return
    }
    setBusy(true)
    try {
      await api.createAssignment({
        title: title.trim(),
        description: description.trim() || undefined,
        kind,
        due_date: dueDate || undefined,
      })
      setTitle('')
      setDescription('')
      setKind('custom')
      setDueDate('')
      setShowAdd(false)
      await reload()
    } catch (e: any) {
      Alert.alert('添加失败', String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(a: Assignment) {
    try {
      const next = a.status === 'completed' ? 'pending' : 'completed'
      await api.updateAssignment(a.id, { status: next })
      await reload()
    } catch (e: any) {
      Alert.alert('更新失败', String(e?.message || e))
    }
  }

  async function remove(a: Assignment) {
    Alert.alert('删除任务', `确定删除"${a.title}"?`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteAssignment(a.id)
            await reload()
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  const overdueCount = useMemo(() => items.filter(isOverdue).length, [items])
  const pendingCount = useMemo(
    () => items.filter((x) => x.status === 'pending').length,
    [items]
  )

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>📋 {isParent ? '我布置的' : '我的待办'}</Text>
          <Text style={styles.subtitle}>
            待办 {pendingCount}
            {overdueCount > 0 ? ` · 逾期 ${overdueCount}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => setShowAdd((v) => !v)}
          style={styles.addBtn}
          hitSlop={8}
        >
          <Text style={styles.addBtnText}>{showAdd ? '取消' : '+ 新增'}</Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {(['pending', 'completed', 'all'] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
          >
            <Text
              style={[
                styles.filterPillText,
                filter === f && styles.filterPillTextActive,
              ]}
            >
              {f === 'pending' ? '进行中' : f === 'completed' ? '已完成' : '全部'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {showAdd && (
          <View style={styles.form}>
            <Text style={styles.label}>标题 *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="完成第三章数学练习题"
              placeholderTextColor="#94a3b8"
              maxLength={100}
              style={styles.input}
            />
            <Text style={styles.label}>类型</Text>
            <View style={styles.kindRow}>
              {KIND_OPTIONS.map((o) => (
                <Pressable
                  key={o.v}
                  onPress={() => setKind(o.v)}
                  style={[
                    styles.kindPill,
                    kind === o.v && styles.kindPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.kindPillText,
                      kind === o.v && styles.kindPillTextActive,
                    ]}
                  >
                    {o.emoji} {o.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>说明 (可选)</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="例如:重点做第 5、8、10 题"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
            <Text style={styles.label}>截止日期 (YYYY-MM-DD)</Text>
            <TextInput
              value={dueDate}
              onChangeText={setDueDate}
              placeholder="2026-05-20"
              placeholderTextColor="#94a3b8"
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              style={styles.input}
              maxLength={10}
            />
            <Pressable
              onPress={handleAdd}
              disabled={busy || !title.trim()}
              style={[styles.saveBtn, (busy || !title.trim()) && { opacity: 0.5 }]}
            >
              <Text style={styles.saveBtnText}>{busy ? '保存中...' : '保存'}</Text>
            </Pressable>
          </View>
        )}

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyTitle}>
              {filter === 'completed' ? '还没有已完成的任务' : '还没有任务'}
            </Text>
            <Text style={styles.emptyHint}>
              {isParent ? '点"+新增"给孩子布置一个' : '让家长布置或自己加一个'}
            </Text>
          </View>
        ) : (
          items.map((a) => {
            const overdue = isOverdue(a)
            const done = a.status === 'completed'
            return (
              <View
                key={a.id}
                style={[
                  styles.item,
                  done && styles.itemDone,
                  overdue && styles.itemOverdue,
                ]}
              >
                <Pressable
                  onPress={() => toggle(a)}
                  style={[styles.checkbox, done && styles.checkboxDone]}
                  hitSlop={8}
                >
                  {done && <Text style={styles.checkboxText}>✓</Text>}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <View style={styles.itemTitleRow}>
                    <Text style={styles.itemEmoji}>{KIND_EMOJI[a.kind] || '📌'}</Text>
                    <Text
                      style={[styles.itemTitle, done && styles.itemTitleDone]}
                      numberOfLines={2}
                    >
                      {a.title}
                    </Text>
                  </View>
                  {!!a.due_date && (
                    <View
                      style={[
                        styles.dueTag,
                        overdue && { backgroundColor: '#fee2e2' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dueTagText,
                          overdue && { color: '#b91c1c' },
                        ]}
                      >
                        📅 {a.due_date}
                      </Text>
                    </View>
                  )}
                  {!!a.description && (
                    <Text style={styles.itemDesc}>{a.description}</Text>
                  )}
                  <Text style={styles.itemMeta}>
                    {a.assigner_name ? `${a.assigner_name} 布置 · ` : ''}
                    {new Date(a.created_at).toLocaleDateString('zh-CN')}
                  </Text>
                </View>
                {(isParent || a.assigner_user_id === user?.id) && (
                  <Pressable
                    onPress={() => remove(a)}
                    hitSlop={8}
                    style={{ paddingLeft: 8 }}
                  >
                    <Text style={styles.removeText}>删除</Text>
                  </Pressable>
                )}
              </View>
            )
          })
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  addBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterPillText: { fontSize: 12, color: colors.slate700 },
  filterPillTextActive: { color: '#fff', fontWeight: '600' },
  scroll: { padding: 12, gap: 8 },
  form: {
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    gap: 6,
  },
  label: {
    fontSize: 11,
    color: colors.slate500,
    marginTop: 6,
    marginBottom: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.slate900,
  },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kindPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  kindPillText: { fontSize: 12, color: colors.slate700 },
  kindPillTextActive: { color: '#fff', fontWeight: '600' },
  saveBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { color: colors.slate700, fontSize: 14, fontWeight: '600' },
  emptyHint: { color: colors.slate500, fontSize: 12, marginTop: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 10,
    marginBottom: 8,
  },
  itemDone: { backgroundColor: '#f1f5f9' },
  itemOverdue: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxDone: { backgroundColor: '#10b981', borderColor: '#10b981' },
  checkboxText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemEmoji: { fontSize: 14 },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.slate900 },
  itemTitleDone: {
    color: colors.slate500,
    textDecorationLine: 'line-through',
  },
  dueTag: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
  },
  dueTagText: { fontSize: 10, color: colors.slate700 },
  itemDesc: { fontSize: 12, color: colors.slate500, marginTop: 4 },
  itemMeta: { fontSize: 10, color: colors.slate500, marginTop: 4 },
  removeText: { color: '#94a3b8', fontSize: 11 },
})
