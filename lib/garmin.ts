import { Session, UserProfile } from './types';

export async function syncSessionToGarmin(
  session: Session,
  _profile: UserProfile
): Promise<{ success: boolean; workoutId?: string; error?: string }> {
  try {
    const email = process.env.GARMIN_EMAIL;
    const password = process.env.GARMIN_PASSWORD;

    if (!email || !password) {
      return { success: false, error: 'GARMIN_EMAIL and GARMIN_PASSWORD environment variables are required' };
    }

    // Dynamic import to avoid issues in non-server contexts
    const { GarminConnect } = await import('garmin-connect');
    const client = new GarminConnect({ username: email, password });
    await client.login();

    // Build workout steps for Garmin
    const workoutSteps = session.steps.map((step, idx) => {
      const reps = step.reps ?? 1;
      const durationSec = step.durationMin * 60 * reps;

      return {
        type: 'ExecutableStepDTO',
        stepId: idx + 1,
        stepOrder: idx + 1,
        stepType: { stepTypeId: 3, stepTypeKey: 'interval' },
        childStepId: null,
        description: null,
        endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' },
        endConditionValue: durationSec,
        preferredEndConditionUnit: null,
        endConditionCompare: null,
        targetType: step.targetPace
          ? { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' }
          : { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' },
        targetValueOne: step.targetPace ? step.targetPace.minSec : null,
        targetValueTwo: step.targetPace ? step.targetPace.maxSec : null,
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
        isRecovery: step.isRecovery ?? false,
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
        userProfilePk: null,
        displayName: null,
        fullName: null,
        profileImgNameLarge: null,
        profileImgNameMedium: null,
        profileImgNameSmall: null,
        userPro: false,
        vivokidUser: false,
      },
      estimatedDurationInSecs: session.totalMin * 60,
      estimatedDistanceInMeters: null,
      estimateType: null,
      estimatedDistanceUnit: { unitId: null, unitKey: null, factor: null },
      poolLength: 0,
      poolLengthUnit: { unitId: null, unitKey: null, factor: null },
      workoutProvider: 'campus_coach',
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

    return { success: true, workoutId };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}
