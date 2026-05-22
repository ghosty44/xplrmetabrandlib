export type Zone = 'EF' | 'Seuil' | 'SSeuilVO2' | 'VO2max' | 'Recup' | 'Neutre';

export type ZoneConfig = {
  label: string;
  color: string;
  description: string;
};

export type Step = {
  zone?: Zone;
  durationMin: number;
  targetPace?: { minSec: number; maxSec: number }; // secondes/km
  reps?: number;
  isRecovery?: boolean;
  // Strength-specific
  exercise?: string;
  sets?: number;
  repCount?: string; // ex: "15 reps", "30s", "10/jambe"
};

export type GpxPoint = { lat: number; lng: number };

export type Session = {
  id: string;
  name: string;
  description?: string;
  steps: Step[];
  totalMin: number;
  week: number;
  day: number; // 1=Lundi...7=Dimanche
  completed: boolean;
  skipped?: boolean;
  garminSynced?: boolean;
  gpxCoords?: GpxPoint[];
  gpxDistanceKm?: number;
  type?: 'running' | 'strength';
};

export type UserProfile = {
  goalRace: 'marathon' | 'halfMarathon' | '10k' | '5k';
  goalDate: string; // ISO date
  goalTimeMin: number; // en minutes
  weeklyKm: number;
  thresholdPaceSec: number; // secondes/km au seuil
  maxHR?: number; // fréquence cardiaque maximale (bpm)
  availableDays?: number[]; // 1=Lundi...7=Dimanche, ex: [2,4,6,7]
  weeklySessionsPerWeek?: number;
  strengthPerWeek?: 0 | 1 | 2;
};

export type TrainingPlan = {
  id: string;
  profile: UserProfile;
  sessions: Session[];
  createdAt: string;
};

export type Shoe = {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  startKm?: number;  // km déjà sur les chaussures avant le début du suivi
  garminId?: number; // gearPk Garmin — présent si importé depuis Garmin
  garminKm?: number; // km total précis depuis Garmin API (mise à jour automatique)
  source?: 'garmin' | 'manual';
};
