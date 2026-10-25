import { SectionSrs } from "./types";

/**
 * SuperMemo SM-2 algorithm modified for typing practice.
 * Rating is 0 to 5:
 * 5 - Perfect recall / high WPM & >95% accuracy
 * 4 - >90% accuracy & good speed
 * 3 - >80% accuracy
 * 2 - High errors (>20% errors)
 * 1 - Failed / aborted
 */
export function calculateSrsRating(accuracy: number, wpm: number, targetWpm: number = 40): number {
  if (accuracy >= 98 && wpm >= targetWpm) return 5;
  if (accuracy >= 92) return 4;
  if (accuracy >= 80) return 3;
  if (accuracy >= 65) return 2;
  return 1;
}

export function updateSrs(
  current: SectionSrs | undefined,
  rating: number,
  today: Date = new Date()
): SectionSrs {
  let ease = current?.ease ?? 2.5;
  let interval = current?.interval ?? 0;
  let repetitions = current?.repetitions ?? 0;

  if (rating >= 3) {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * ease);
    }
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 1;
  }

  // Calculate new ease factor: EF' = EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
  ease = ease + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
  if (ease < 1.3) ease = 1.3;

  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + interval);
  const due = dueDate.toISOString().slice(0, 10);

  return {
    ease: Math.round(ease * 100) / 100,
    interval,
    repetitions,
    due,
  };
}

export function isDueToday(dueStr: string, today: Date = new Date()): boolean {
  if (!dueStr) return true;
  const todayStr = today.toISOString().slice(0, 10);
  return dueStr <= todayStr;
}
