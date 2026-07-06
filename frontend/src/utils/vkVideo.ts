// Parses vkvideo.ru / vk.com video links (e.g. https://vkvideo.ru/video-240080860_456239018)
// and builds the vk.com/video_ext.php iframe embed URL — the standard VK video
// embed endpoint, shared by both domains since vkvideo.ru runs on VK's backend.

export interface VkVideoRef {
  oid: string
  id:  string
}

export function parseVkVideoUrl(url: string): VkVideoRef | null {
  const match = url.match(/video(-?\d+)_(\d+)/)
  if (!match) return null
  return { oid: match[1], id: match[2] }
}

export function buildVkEmbedUrl(url: string): string | null {
  const ref = parseVkVideoUrl(url)
  if (!ref) return null
  return `https://vk.com/video_ext.php?oid=${ref.oid}&id=${ref.id}&hd=2`
}
