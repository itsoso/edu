/**
 * MdViewer — 对齐 web 的 frontend/src/components/MdViewer.tsx.
 *
 * 纯展示, 无交互. 使用 react-native-markdown-display.
 */
import React from 'react'
import { StyleSheet } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { colors } from '../lib/theme'

export default function MdViewer({ markdown }: { markdown: string }) {
  return <Markdown style={mdStyles}>{markdown || ''}</Markdown>
}

const mdStyles = StyleSheet.create({
  body: {
    color: colors.slate700,
    fontSize: 15,
    lineHeight: 24,
  },
  heading1: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.slate900,
    marginTop: 16,
    marginBottom: 10,
  },
  heading2: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.slate900,
    marginTop: 14,
    marginBottom: 8,
  },
  heading3: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.slate800,
    marginTop: 12,
    marginBottom: 6,
  },
  heading4: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.slate800,
    marginTop: 10,
    marginBottom: 4,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 10,
    color: colors.slate700,
    fontSize: 15,
    lineHeight: 24,
  },
  strong: { fontWeight: '700', color: colors.slate900 },
  em: { fontStyle: 'italic' },
  link: { color: colors.brand, textDecorationLine: 'underline' },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 4, color: colors.slate700 },
  code_inline: {
    backgroundColor: '#f1f5f9',
    color: '#be185d',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  code_block: {
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'Menlo',
    fontSize: 13,
    marginVertical: 8,
  },
  fence: {
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'Menlo',
    fontSize: 13,
    marginVertical: 8,
  },
  blockquote: {
    backgroundColor: colors.brandLight,
    borderLeftWidth: 4,
    borderLeftColor: colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 8,
  },
  hr: {
    backgroundColor: colors.divider,
    height: 1,
    marginVertical: 12,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 6,
    marginVertical: 8,
  },
  thead: { backgroundColor: '#f8fafc' },
  th: {
    padding: 8,
    fontWeight: '700',
    color: colors.slate800,
  },
  td: {
    padding: 8,
    color: colors.slate700,
  },
  tr: {
    borderBottomWidth: 1,
    borderColor: colors.divider,
  },
})
