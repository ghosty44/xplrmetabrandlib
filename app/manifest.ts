import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RunAI',
    short_name: 'RunAI',
    description: 'Ton plan running personnalisé',
    start_url: '/',
    display: 'standalone',
    background_color: '#F2F2F7',
    theme_color: '#0F0F10',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
