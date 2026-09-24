/**
 * A SERVER TIMESTAMP AS A LAGOS WALL TIME, for every screen that shows one
 * (R-2026-09-24-97 BY-2 c; PR 3.4b-app C).
 *
 * Lagos, whatever zone the device is in: the operator is often in Hong Kong, and a
 * ward or a crew reads Lagos time. The zone is named here, so the device's own zone
 * never enters (tests/compliance/lagos_time.test.ts runs this under
 * TZ=Asia/Hong_Kong in a child process, with UTC as the control).
 *
 * Moved here from apps/public-dashboard/src/age-view.ts when the admin app became
 * its second caller, so the two screens cannot disagree about a time. The
 * dashboard's rendered strings were compared byte for byte before and after the move.
 *
 * Formats the instant it is given; reads no clock.
 */
export function lagosTime(isoString: string): string {
  const at = new Date(isoString);
  const text = at.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    day: 'numeric',
    month: 'short',
  });
  return `${text} (Lagos time)`;
}
