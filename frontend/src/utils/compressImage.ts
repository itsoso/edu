// 前端图片压缩: canvas 等比缩放 + JPEG 重编码
// 目标: 手机拍照 3-5MB → 压到 <1MB, 同时保留足够清晰度让 vision 模型识别文字

export type CompressResult = {
  file: File
  originalSize: number
  compressedSize: number
  width: number
  height: number
  durationMs: number
}

export type CompressOptions = {
  maxWidth?: number    // 默认 1600 — OpenClaw 识别文字够用
  maxHeight?: number   // 默认 1600
  quality?: number     // 0-1, 默认 0.85
  mimeType?: string    // 默认 'image/jpeg'
}

/**
 * 压缩单张图片. 如果已经比目标小就原样返回.
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = {}
): Promise<CompressResult> {
  const {
    maxWidth = 1600,
    maxHeight = 1600,
    quality = 0.85,
    mimeType = 'image/jpeg',
  } = opts

  const startAt = Date.now()
  const original = file.size

  // 非图片或 SVG 直接返回
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return {
      file,
      originalSize: original,
      compressedSize: original,
      width: 0,
      height: 0,
      durationMs: Date.now() - startAt,
    }
  }

  const img = await loadImage(file)

  // 计算目标尺寸, 保持宽高比
  let { width, height } = img
  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  // 如果原图尺寸已经符合 + 文件 < 1MB, 直接返回原文件
  if (width === img.width && height === img.height && original < 1024 * 1024) {
    URL.revokeObjectURL(img.src)
    return {
      file,
      originalSize: original,
      compressedSize: original,
      width,
      height,
      durationMs: Date.now() - startAt,
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  // 白底 (JPEG 不支持透明, 防止黑底)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  URL.revokeObjectURL(img.src)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      mimeType,
      quality
    )
  })

  // 如果压缩后反而更大 (罕见, 极小图 PNG→JPEG 有时更大), 返回原图
  if (blob.size >= original) {
    return {
      file,
      originalSize: original,
      compressedSize: original,
      width: img.width,
      height: img.height,
      durationMs: Date.now() - startAt,
    }
  }

  // 替换文件名后缀为 .jpg
  const origName = file.name.replace(/\.[^.]+$/, '') || 'image'
  const compressed = new File([blob], `${origName}.jpg`, {
    type: mimeType,
    lastModified: Date.now(),
  })

  return {
    file: compressed,
    originalSize: original,
    compressedSize: compressed.size,
    width,
    height,
    durationMs: Date.now() - startAt,
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = URL.createObjectURL(file)
  })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 多张图片纵向拼接成一张. 每张先按 maxWidth 缩放到相同宽度, 再垂直叠放.
 * 总高度上限 maxTotalHeight (默认 6000px), 超过则按比例整体缩小.
 */
export async function stitchImagesVertical(
  files: File[],
  opts: CompressOptions & { gap?: number; maxTotalHeight?: number } = {}
): Promise<CompressResult> {
  const {
    maxWidth = 1600,
    quality = 0.85,
    mimeType = 'image/jpeg',
    gap = 16,
    maxTotalHeight = 6000,
  } = opts
  const startAt = Date.now()
  const originalTotal = files.reduce((s, f) => s + f.size, 0)

  if (files.length === 0) throw new Error('no files')
  if (files.length === 1) return compressImage(files[0], opts)

  // 加载所有图片
  const imgs = await Promise.all(files.map((f) => loadImage(f)))

  // 统一缩放宽度为 maxWidth (或所有图片中最小的原始宽度, 取较小者)
  const baseWidth = Math.min(maxWidth, ...imgs.map((i) => i.width))
  const scaled = imgs.map((img) => {
    const ratio = baseWidth / img.width
    return { img, w: baseWidth, h: Math.round(img.height * ratio) }
  })

  let totalH = scaled.reduce((s, x) => s + x.h, 0) + gap * (scaled.length - 1)
  let finalScale = 1
  if (totalH > maxTotalHeight) {
    finalScale = maxTotalHeight / totalH
    totalH = maxTotalHeight
  }
  const finalW = Math.round(baseWidth * finalScale)

  const canvas = document.createElement('canvas')
  canvas.width = finalW
  canvas.height = Math.round(totalH)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let y = 0
  for (let i = 0; i < scaled.length; i++) {
    const { img, w, h } = scaled[i]
    const dw = Math.round(w * finalScale)
    const dh = Math.round(h * finalScale)
    ctx.drawImage(img, 0, y, dw, dh)
    URL.revokeObjectURL(img.src)
    y += dh
    if (i < scaled.length - 1) {
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(0, y, canvas.width, gap)
      y += gap
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      mimeType,
      quality
    )
  })

  const name = `stitched-${files.length}pages-${Date.now()}.jpg`
  const file = new File([blob], name, { type: mimeType, lastModified: Date.now() })
  return {
    file,
    originalSize: originalTotal,
    compressedSize: file.size,
    width: canvas.width,
    height: canvas.height,
    durationMs: Date.now() - startAt,
  }
}
