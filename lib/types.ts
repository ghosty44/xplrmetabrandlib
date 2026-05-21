export type Zone = 'EF' | 'Seuil' | 'SSeuilVO2' | 'VO2max' | 'Recup' | 'Neutre';

export type ZoneConfig = {
  label: string;
  color: string;
  description: string;
};

export type Step = {
  zone: Zone;
  durationMin: number;
  targetPace?: { minSec: number; maxSec: number }; // secondes/km
  reps?: number;
  isRecovery?: boolean;
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
  garminSynced?: boolean;
  gpxCoords?: GpxPoint[];
  gpxDistanceKm?: number;
};

export type UserProfile = {
  goalRace: 'marathon' | 'halfMarathon' | '10k' | '5k';
  goalDate: string; // ISO date
  goalTimeMin: number; // en minutes
  weeklyKm: number;
  thresholdPaceSec: number; // secondes/km au seuil
  maxHR?: number; // fréquence cardiaque maximale (bpm)
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
};
