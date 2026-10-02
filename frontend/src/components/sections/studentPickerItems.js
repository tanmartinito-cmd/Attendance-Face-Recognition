const studentName = (student) => `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim() || student.student_id;

/**
 * Search items for the "Enroll Student into this Section" picker.
 * A student already covered by this section for the chosen scope is listed but disabled:
 * a block (regular) student covers every subject; an irregular student only the subject
 * they were added to.
 */
export function studentPickerItems(allStudents, enrollments, enrollType, enrollSubjectId) {
  const block = new Set();
  const bySubject = new Set();
  enrollments.forEach((enrollment) => {
    const id = String(enrollment.student ?? enrollment.student_details?.id ?? '');
    if (!enrollment.is_irregular) block.add(id);
    else bySubject.add(`${id}:${enrollment.subject ?? enrollment.subject_details?.id ?? ''}`);
  });
  return allStudents.map((student) => {
    const id = String(student.id);
    const taken = block.has(id) || (enrollType === 'irregular' && bySubject.has(`${id}:${enrollSubjectId}`));
    return {
      id: student.id,
      label: studentName(student),
      sublabel: [student.student_id, student.course].filter(Boolean).join(' · '),
      terms: [student.user?.first_name, student.user?.last_name, student.student_id, student.course].filter(Boolean),
      disabled: taken,
      note: taken ? 'Already in this section' : undefined,
    };
  });
}
