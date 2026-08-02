/**
 * 图像拾取 + 上传前压缩 + 失败降级重试.
 *
 * 统一封装 launchCamera/launchImageLibrary 的参数,
 * 并提供 uploadWithRetry: 第一次按正常档位上传, 失败自动降一档.
 *
 * 档位:
 *   TIER_A: 2000px q0.85  (试卷 — 默认, 清晰度优先)
 *   TIER_B: 1600px q0.75  (作文 — 手写更大, 可小)
 *   TIER_C: 1200px q0.6   (降级重试, 避免极端大图)
 */
import {
  Asset,
  CameraOptions,
  ImageLibraryOptions,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker'

export type CompressScene = 'scan' | 'essay'

export type CompressTier = {
  maxWidth: number
  maxHeight: number
  quality: number
  label: string
}

const TIERS: Record<CompressScene, CompressTier[]> = {
  // 试卷: 先正常档, 失败后连降两档
  scan: [
    { maxWidth: 2000, maxHeight: 2000, quality: 0.85, label: 'A/scan' },
    { maxWidth: 1600, maxHeight: 1600, quality: 0.75, label: 'B/scan' },
    { maxWidth: 1200, maxHeight: 1200, quality: 0.6, label: 'C/scan' },
  ],
  // 作文: 初档就相对小, 仍保留 2 级降级
  essay: [
    { maxWidth: 1600, maxHeight: 1600, quality: 0.75, label: 'A/essay' },
    { maxWidth: 1200, maxHeight: 1200, quality: 0.6, label: 'B/essay' },
  ],
}

function pickerOpts(tier: CompressTier): CameraOptions & ImageLibraryOptions {
  return {
    mediaType: 'photo',
    quality: tier.quality as any,
    maxWidth: tier.maxWidth,
    maxHeight: tier.maxHeight,
  }
}

export async function pickImage(
  source: 'camera' | 'library',
  scene: CompressScene
): Promise<Asset | null> {
  const tier = TIERS[scene][0]
  const fn = source === 'camera' ? launchCamera : launchImageLibrary
  const extra = source === 'camera' ? { saveToPhotos: false } : {}
  const res = await fn({ ...pickerOpts(tier), ...extra } as any)
  if (res.didCancel) return null
  if (res.errorCode) {
    throw new Error(res.errorMessage || res.errorCode)
  }
  return res.assets?.[0] ?? null
}

/**
 * 多图选择 (仅图库). 返回最多 max 张资源, 用户可在系统选图器里按顺序勾选.
 * 注意: iOS / Android 的 selectionLimit 对应原生 PHPickerViewController / Android 13+ photo picker.
 */
export async function pickImagesMulti(
  scene: CompressScene,
  max: number
): Promise<Asset[]> {
  const tier = TIERS[scene][0]
  const res = await launchImageLibrary({
    ...pickerOpts(tier),
    selectionLimit: max,
  } as any)
  if (res.didCancel) return []
  if (res.errorCode) {
    throw new Error(res.errorMessage || res.errorCode)
  }
  return (res.assets || []).slice(0, max)
}

/**
 * 判断错误是否值得降级重试.
 *   - 400 "Invalid image_url" — LLM 网关拒收大图
 *   - 413 Payload Too Large — nginx 拒收
 *   - 502/504 — 上游超时/OOM
 */
export function shouldRetryWithSmaller(err: any): boolean {
  const status = err?.status
  const msg = String(err?.message || err || '').toLowerCase()
  if (status === 413 || status === 502 || status === 504) return true
  if (status === 400 && /image|payload|size|large/.test(msg)) return true
  if (/gateway\s*(400|413|502|504)/.test(msg)) return true
  return false
}

/**
 * 重新以更小档位拾取 — image-picker 的 maxWidth/maxHeight/quality
 * 是在原生层降采样, 再次调用 picker 即获得更小的文件.
 *
 * 备注: iOS picker 无法"重新用同一张照片"压得更狠, 因此重试时
 * 让用户重新选/拍一次. 对大多数失败用户来说这可以接受.
 *
 * 如果以后引入 react-native-image-resizer, 这里可以改成直接
 * 对已有 uri 再压一次, 无需用户交互.
 */
export async function retryPickWithTier(
  source: 'camera' | 'library',
  scene: CompressScene,
  tierIdx: number
): Promise<Asset | null> {
  const tiers = TIERS[scene]
  if (tierIdx >= tiers.length) return null
  const fn = source === 'camera' ? launchCamera : launchImageLibrary
  const extra = source === 'camera' ? { saveToPhotos: false } : {}
  const res = await fn({ ...pickerOpts(tiers[tierIdx]), ...extra } as any)
  if (res.didCancel) return null
  if (res.errorCode) {
    throw new Error(res.errorMessage || res.errorCode)
  }
  return res.assets?.[0] ?? null
}

export function tierLabel(scene: CompressScene, idx: number): string {
  return TIERS[scene][idx]?.label ?? 'unknown'
}
