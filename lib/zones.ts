import { Zone, ZoneConfig } from './types';

export const ZONE_CONFIGS: Record<Zone, ZoneConfig> = {
  EF: {
    label: 'Endurance Fondamentale',
    color: '#c8e635',
    description: 'Allure confortable, conversation possible',
  },
  Seuil: {
    label: 'Seuil',
    color: '#7c1c1c',
    description: 'Allure seuil lactique, effort soutenu',
  },
  SSeuilVO2: {
    label: 'Sous-Seuil / VO2',
    color: '#c0392b',
    description: 'Entre seuil et VO2max, effort intense',
  },
  VO2max: {
    label: 'VO2max',
    color: '#e85d04',
    description: 'Consommation maximale d\'oxygène',
  },
  Recup: {
    label: 'Récupération',
    color: '#f4a7b9',
    description: 'Allure très facile, récupération active',
  },
  Neutre: {
    label: 'Neutre',
    color: '#9ca3af',
    description: 'Zone neutre de transition',
  },
};

export function getZoneConfig(zone: Zone): ZoneConfig {
  return ZONE_CONFIGS[zone];
}

export function formatPace(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.round(sec % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getZonePaceRange(
  zone: Zone,
  thresholdSec: number
): { minSec: number; maxSec: number } {
  switch (zone) {
    case 'EF':
      return { minSec: Math.round(thresholdSec * 1.28), maxSec: Math.round(thresholdSec * 1.38) };
    case 'Seuil':
      return { minSec: Math.round(thresholdSec * 1.0), maxSec: Math.round(thresholdSec * 1.05) };
    case 'SSeuilVO2':
      return { minSec: Math.round(thresholdSec * 1.07), maxSec: Math.round(thresholdSec * 1.15) };
    case 'VO2max':
      return { minSec: Math.round(thresholdSec * 0.88), maxSec: Math.round(thresholdSec * 0.94) };
    case 'Recup':
      return { minSec: Math.round(thresholdSec * 1.45), maxSec: Math.round(thresholdSec * 1.60) };
    case 'Neutre':
      return { minSec: Math.round(thresholdSec * 1.20), maxSec: Math.round(thresholdSec * 1.25) };
  }
}
