import { Session, UserProfile } from './types';
import { ZONE_CONFIGS } from './zones';
import type { GarminTokens } from './store';
import { getSessionDate, formatDateYYYYMMDD } from './dates';

export type GarminSyncResult = {
  success: boolean;
  workoutId?: string;
  scheduledDate?: string;
  refreshedTokens?: GarminTokens;
  error?: string;
};

function stepType(idx: number, total: number, isRecovery: boolean) {
  if (idx === 0) return { stepTypeId: 1, stepTypeKey: 'warmup' };
  if (idx === total - 1) return { stepTypeId: 2, stepTypeKey: 'cooldown' };
  if (isRecovery) return { stepTypeId: 5, stepTypeKey: 'rest' };
  return { stepTypeId: 3, stepTypeKey: 'interval' };
}

export async function loginGarmin(
  email: string,
  password: string
): Promise<{ success: boolean; tokens?: GarminTokens; error?: string }> {
  try {
    const { GarminConnect } = await import('garmin-connect');
    const client = new GarminConnect({ username: email, password });
    await client.login();
    const tokens = client.exportToken() as GarminTokens;
    return { success: true, tokens };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}

export async function syncSessionToGarmin(
  session: Session,
  _profile: UserProfile,
  tokens?: GarminTokens,
  planCreatedAt?: string
): Promise<GarminSyncResult> {
  try {
    const { GarminConnect } = await import('garmin-connect');

    let client: InstanceType<typeof GarminConnect>;

    if (tokens) {
      client = new GarminConnect({ username: '', password: '' });
      client.loadToken(tokens.oauth1, tokens.oauth2);
    } else {
      const email = process.env.GARMIN_EMAIL;
      const password = process.env.GARMIN_PASSWORD;
      if (!email || !password) {
        return {
          success: false,
          error: 'Aucun compte Garmin connecté. Connectez votre compte dans les Paramètres.',
        };
      }
      client = new GarminConnect({ username: email, password });
      await client.login();
    }

    const total = session.steps.length;
    const workoutSteps = session.steps.map((step, idx) => {
      const reps = step.reps ?? 1;
      const durationSec = step.durationMin * 60 * reps;
      const zoneLabel = step.zone ? (ZONE_CONFIGS[step.zone]?.label ?? step.zone) : (step.exercise ?? 'Exercice');
      const isRecovery = step.isRecovery ?? false;

      // Garmin pace targets are in m/s (speed), not sec/km
      // minSec = faster pace (fewer sec/km = more m/s) → upper speed bound
      // maxSec = slower pace (more sec/km = fewer m/s) → lower speed bound
      const targetValueOne = step.targetPace ? 1000 / step.targetPace.maxSec : null;
      const targetValueTwo = step.targetPace ? 1000 / step.targetPace.minSec : null;

      return {
        type: 'ExecutableStepDTO',
        stepId: idx + 1,
        stepOrder: idx + 1,
        stepType: stepType(idx, total, isRecovery),
        childStepId: null,
        description: zoneLabel,
        endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' },
        endConditionValue: durationSec,
        preferredEndConditionUnit: null,
        endConditionCompare: null,
        targetType: step.targetPace
          ? { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' }
          : { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
        targetValueOne,
        targetValueTwo,
        targetValueUnit: null,
        zoneNumber: null,
        secondaryTargetType: null,
        secondaryTargetValueOne: null,
        secondaryTargetValueTwo: null,
        secondaryTargetValueUnit: null,
        secondaryZoneNumber: null,
        endConditionZone: null,
        strokeType: { strokeTypeId: 0, strokeTypeKey: 'no_stroke' },
        equipmentType: { equipmentTypeId: 0, equipmentTypeKey: 'none' },
        category: null,
        exerciseName: null,
        workoutProvider: null,
      };
    });

    const workoutDetail = {
      workoutName: session.name,
      description: session.description ?? '',
      updateDate: new Date(),
      createdDate: new Date(),
      sportType: { sportTypeId: 1, sportTypeKey: 'running' },
      trainingPlanId: null,
      author: {
        userProfilePk: null, displayName: null, fullName: null,
        profileImgNameLarge: null, profileImgNameMedium: null, profileImgNameSmall: null,
        userPro: false, vivokidUser: false,
      },
      estimatedDurationInSecs: session.totalMin * 60,
      estimatedDistanceInMeters: null,
      estimateType: null,
      estimatedDistanceUnit: { unitId: null, unitKey: null, factor: null },
      poolLength: 0,
      poolLengthUnit: { unitId: null, unitKey: null, factor: null },
      workoutProvider: 'runai',
      workoutSourceId: session.id,
      consumer: null,
      atpPlanId: null,
      workoutNameI18nKey: null,
      descriptionI18nKey: null,
      shared: false,
      estimated: false,
      workoutSegments: [
        {
          segmentOrder: 1,
          sportType: { sportTypeId: 1, sportTypeKey: 'running' },
          workoutSteps,
        },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await client.addWorkout(workoutDetail as any);
    const workoutId = result?.workoutId ? String(result.workoutId) : undefined;

    // Schedule the workout on the calendar if we have a date
    let scheduledDate: string | undefined;
    if (workoutId && planCreatedAt) {
      const sessionDate = getSessionDate(planCreatedAt, session.week, session.day);
      scheduledDate = formatDateYYYYMMDD(sessionDate);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any).post(
          `https://connectapi.garmin.com/workout-service/schedule/${workoutId}`,
          { date: scheduledDate }
        );
      } catch {
        // scheduling failed but workout was created — non-fatal
        scheduledDate = undefined;
      }
    }

    // Export refreshed tokens so client can persist them
    const refreshedTokens = client.exportToken() as GarminTokens;

    return { success: true, workoutId, scheduledDate, refreshedTokens };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}
