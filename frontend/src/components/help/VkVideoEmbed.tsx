import { buildVkEmbedUrl } from '../../utils/vkVideo'

interface Props {
  vkVideoUrl: string | null
  title:      string
}

export default function VkVideoEmbed({ vkVideoUrl, title }: Props) {
  const embedUrl = vkVideoUrl ? buildVkEmbedUrl(vkVideoUrl) : null

  if (!embedUrl) {
    return (
      <div className="aspect-video w-full rounded-lg border border-border bg-surface-warm flex items-center justify-center">
        <p className="text-sm font-sans text-ink-tertiary px-6 text-center">Видео скоро появится.</p>
      </div>
    )
  }

  return (
    <div className="aspect-video w-full rounded-lg overflow-hidden border border-border">
      <iframe
        src={embedUrl}
        title={title}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className="w-full h-full"
      />
    </div>
  )
}
