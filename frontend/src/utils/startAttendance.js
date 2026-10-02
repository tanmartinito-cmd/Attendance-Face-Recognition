import { Api } from '../api';
import { askLateStartChoice } from '../ui/LateStartDialog';

/**
 * Start today's attendance for a schedule. When the instructor starts late, ask how students
 * should be counted (Present from now, or Late with a reason) and start with that choice.
 * Returns the session, or null when the instructor cancelled the question.
 */
export async function startAttendanceSession(scheduleId) {
  try {
    return await Api.startSession(scheduleId);
  } catch (error) {
    if (error?.code !== 'late_start') throw error;
    const choice = await askLateStartChoice(error.details || {});
    if (!choice) return null;
    return Api.startSession(scheduleId, choice);
  }
}
