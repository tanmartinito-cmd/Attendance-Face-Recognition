import { useEffect, useState } from 'react';
import { Edit2, X, AlertCircle } from 'lucide-react';
import { ModalBackdrop } from '../../ui';
import { scheduleErrorText } from '../../utils/errorMessages';

/** Edit a term offering while keeping its identity linked to the Section Catalog. */
export default function EditSectionModal({ isOpen, section, onClose, onUpdate, programs, courses = [], catalogSections = [] }) {
  const [formData, setFormData] = useState({ name: '', program_section: '', program: '', course: '', course_ref: '', year_level: 1, school_year: '2025-2026', semester: '1st' });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!section) return;
    setFormData({
      name: section.name || '',
      program_section: section.program_section || section.program_section_details?.id || '',
      program: section.program_details?.id || section.program || section.program_section_details?.program || '',
      course: section.course || section.course_details?.code || section.program_section_details?.course_details?.code || section.program_section_details?.course || '',
      course_ref: section.course_ref || section.course_details?.id || section.program_section_details?.course_ref || '',
      year_level: section.year_level || 1,
      school_year: section.school_year || '2025-2026',
      semester: section.semester || '1st',
    });
    setErrorMsg('');
  }, [section]);

  const matchingCatalogSections = catalogSections.filter((catalogSection) => (
    (!formData.program || String(catalogSection.program) === String(formData.program) || String(catalogSection.program_details?.id) === String(formData.program))
    && (!formData.course_ref || String(catalogSection.course_ref) === String(formData.course_ref) || String(catalogSection.course_details?.id) === String(formData.course_ref))
  ));

  const selectCatalogSection = (value) => {
    const catalogSection = catalogSections.find((item) => String(item.id) === String(value));
    if (!catalogSection) return;
    const courseId = catalogSection.course_ref || catalogSection.course_details?.id || formData.course_ref;
    const course = courses.find((item) => String(item.id) === String(courseId));
    setFormData({ ...formData, program_section: value, name: catalogSection.name, year_level: catalogSection.year_level || 1, program: catalogSection.program || catalogSection.program_details?.id || formData.program, course_ref: courseId, course: course?.code || catalogSection.course_details?.code || catalogSection.course || '' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.program_section) {
      setErrorMsg('Select a Section Catalog definition.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      await onUpdate(section.id, formData);
      onClose();
    } catch (error) {
      setErrorMsg(scheduleErrorText(error, 'Failed to update section.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !section) return null;

  return (
    <ModalBackdrop onClose={onClose} busy={submitting}>
      <div className="modal-card" style={{ maxWidth: '600px', width: '100%', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
        <div className="modal-header" style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 className="modal-title" style={{ fontSize: '16px', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><Edit2 size={18} style={{ color: 'var(--primary)' }} /><span>Edit Section: {section.name}</span></h3><button type="button" className="btn btn-icon btn-outline btn-sm modal-close-btn" onClick={onClose} style={{ padding: '4px', border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button></div>
        <form onSubmit={handleSubmit}><div className="modal-body" style={{ padding: '20px 22px', maxHeight: '70vh', overflowY: 'auto' }}>
          {errorMsg && <div className="alert alert-danger" role="alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '13px' }}><AlertCircle size={16} /><span style={{ whiteSpace: 'pre-line' }}>{errorMsg}</span></div>}
          <div className="form-group" style={{ marginBottom: '16px' }}><label className="form-label">Program / College *</label><select className="form-select" value={formData.program} required onChange={(event) => setFormData({ ...formData, program: event.target.value, course_ref: '', course: '', program_section: '', name: '', year_level: 1 })}><option value="">Select Program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.code} - {program.name}</option>)}</select></div>
          <div className="form-group" style={{ marginBottom: '16px' }}><label className="form-label">Course *</label><select className="form-select" value={formData.course_ref} required disabled={!formData.program} onChange={(event) => setFormData({ ...formData, course_ref: event.target.value, course: courses.find((item) => String(item.id) === String(event.target.value))?.code || '', program_section: '', name: '', year_level: 1 })}><option value="">{formData.program ? 'Select Course' : 'Select a program first'}</option>{courses.filter((course) => String(course.program) === String(formData.program)).map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}</select></div>
          <div className="form-group" style={{ marginBottom: '16px' }}><label className="form-label">Section Catalog *</label><select className="form-select" value={formData.program_section} required disabled={!formData.course_ref} onChange={(event) => selectCatalogSection(event.target.value)}><option value="">{formData.course_ref ? 'Select Section Catalog definition' : 'Select a course first'}</option>{matchingCatalogSections.map((catalogSection) => <option key={catalogSection.id} value={catalogSection.id}>{catalogSection.name} ({catalogSection.course_details?.code || catalogSection.course || 'Course'} - {catalogSection.year_level}Y)</option>)}</select></div>
          <div className="grid-2" style={{ gap: '16px', marginBottom: '16px' }}><div className="form-group"><label className="form-label">Section Name</label><input className="form-control" value={formData.name} readOnly placeholder="Inherited from Section Catalog" /></div><div className="form-group"><label className="form-label">Year Level</label><input className="form-control" value={formData.year_level ? `${formData.year_level}${formData.year_level === 1 ? 'st' : formData.year_level === 2 ? 'nd' : formData.year_level === 3 ? 'rd' : 'th'} Year` : ''} readOnly /></div></div>
          <div className="grid-2" style={{ gap: '16px' }}><div className="form-group"><label className="form-label">School Year</label><input type="text" className="form-control" value={formData.school_year} onChange={(event) => setFormData({ ...formData, school_year: event.target.value })} placeholder="e.g. 2025-2026" /></div><div className="form-group"><label className="form-label">Semester</label><select className="form-select" value={formData.semester} onChange={(event) => setFormData({ ...formData, semester: event.target.value })}><option value="1st">1st Semester</option><option value="2nd">2nd Semester</option><option value="summer">Summer</option></select></div></div>
        </div><div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}><button type="button" className="btn btn-outline" data-modal-close onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Updating...' : <><span>Update Section</span></>}</button></div></form>
      </div>
    </ModalBackdrop>
  );
}
