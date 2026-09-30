import { useEffect, useState } from 'react';
import { X, BookOpen, Trash2, Edit2, Power } from 'lucide-react';
import { Api } from '../api';
import ActionPopover from '../components/shared/ActionPopover';
import Toast from '../components/shared/Toast';
import { confirmAction, TableLoadingRow, StatusBadge, changeActiveStatus, ModalBackdrop, usePageLoading } from '../ui';

const emptyProgram = { code: '', name: '', college: '', description: '' };

export default function ProgramsView({ user, onSetHeaderInfo }) {
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = usePageLoading(() => loadPrograms());
  const [showAddProgram, setShowAddProgram] = useState(false);
  const [editingProgram, setEditingProgram] = useState(null);
  const [programForm, setProgramForm] = useState(emptyProgram);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const isAdmin = user?.role === 'admin';

  const loadPrograms = async () => {
    try {
      setLoading(true);
      setPrograms(await Api.getPrograms());
    } catch (error) {
      setErrorMsg(error.message || 'Failed to load programs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPrograms(); }, []);

  useEffect(() => {
    onSetHeaderInfo?.({
      title: 'Academic Programs',
      subtitle: 'Manage Programs. Courses are managed separately under the Courses page.',
      headerActions: isAdmin ? (
        <button type="button" className="btn btn-primary" onClick={() => { setProgramForm(emptyProgram); setErrorMsg(''); setShowAddProgram(true); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          Add Program
        </button>
      ) : null,
    });
  }, [isAdmin, onSetHeaderInfo]);

  const submitProgram = async (event) => {
    event.preventDefault();
    if (!programForm.code.trim() || !programForm.name.trim() || !programForm.college.trim()) {
      setErrorMsg('Program code, name, and college are required.');
      return;
    }
    try {
      setSubmitting(true);
      if (editingProgram) await Api.updateProgram(editingProgram.id, programForm);
      else await Api.createProgram(programForm);
      setSuccessMsg(editingProgram ? 'Program updated successfully.' : 'Program created successfully.');
      setShowAddProgram(false);
      setEditingProgram(null);
      setProgramForm(emptyProgram);
      await loadPrograms();
    } catch (error) {
      setErrorMsg(error.message || 'Failed to save program.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditProgram = (program) => {
    setEditingProgram(program);
    setProgramForm({ code: program.code || '', name: program.name || '', college: program.college || '', description: program.description || '' });
    setErrorMsg('');
    setShowAddProgram(true);
  };

  return (
    <div className="page-content">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      <div className="card">
        <div className="table-container" style={{ border: 'none', margin: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Program Name</th>
                <th>College / Department</th>
                <th>Courses</th>
                <th>Sections</th>
                <th>Subjects</th>
                <th>Status</th>
                {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? <TableLoadingRow colSpan={isAdmin ? 8 : 7} label="Loading programs…" /> : programs.length === 0 ? (
                <tr><td colSpan={isAdmin ? 8 : 7} className="text-center text-muted" style={{ padding: '36px' }}>No academic programs found.</td></tr>
              ) : programs.map((program) => (
                <tr key={program.id} className={program.is_active === false ? 'row-inactive' : undefined}>
                  <td><span className="code-tag">{program.code}</span></td>
                  <td><strong>{program.name}</strong></td>
                  <td><span className="text-muted">{program.college || '—'}</span></td>
                  <td className="num-cell">{program.course_count || 0}</td>
                  <td className="num-cell">{program.section_count || 0}</td>
                  <td className="num-cell">{program.subject_count || 0}</td>
                  <td><StatusBadge active={program.is_active !== false} /></td>
                  {isAdmin && (
                    <td style={{ textAlign: 'right' }}>
                      <ActionPopover items={[
                        { label: 'Edit Program', icon: Edit2, onClick: () => openEditProgram(program) },
                        {
                          label: program.is_active !== false ? 'Deactivate Program' : 'Activate Program',
                          icon: Power,
                          isSuccess: program.is_active === false,
                          onClick: () => changeActiveStatus({
                            entity: 'Program',
                            name: program.code,
                            isActive: program.is_active !== false,
                            impact: `Program ${program.code} will be temporarily closed. Its courses, sections and subjects stay in the system, but attendance cannot be taken for its classes until it is activated again.`,
                            update: (data) => Api.updateProgram(program.id, data),
                            onSuccess: async (msg) => { setSuccessMsg(msg); await loadPrograms(); },
                            onError: setErrorMsg,
                          }),
                        },
                        { isDivider: true },
                        {
                          label: 'Delete Program',
                          icon: Trash2,
                          isDanger: true,
                          onClick: async () => {
                            if (!(await confirmAction({ title: `Delete program ${program.code}?`, message: 'A program can only be deleted when no courses depend on it. This cannot be undone.', confirmLabel: 'Delete program', tone: 'danger' }))) return;
                            try { await Api.deleteProgram(program.id); setSuccessMsg(`Program ${program.code} deleted.`); await loadPrograms(); }
                            catch (error) { setErrorMsg(error.message || 'Program cannot be deleted while it is in use.'); }
                          },
                        },
                      ]} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddProgram && <ProgramModal editing={Boolean(editingProgram)} formData={programForm} setFormData={setProgramForm} submitting={submitting} errorMsg={errorMsg} onSubmit={submitProgram} onClose={() => { setShowAddProgram(false); setEditingProgram(null); }} />}
    </div>
  );
}

function ProgramModal({ editing, formData, setFormData, submitting, errorMsg, onSubmit, onClose }) {
  return <Modal title={editing ? 'Edit Program' : 'Add Academic Program'} icon={editing ? <Edit2 size={18} /> : <BookOpen size={18} />} onClose={onClose} busy={submitting}>
    <form onSubmit={onSubmit}><div className="modal-body" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>{errorMsg && <div className="alert alert-danger">{errorMsg}</div>}<div className="grid-2"><Field label="Program Code *"><input className="form-control" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })} required /></Field><Field label="College / Department *"><input className="form-control" value={formData.college} onChange={(e) => setFormData({ ...formData, college: e.target.value })} required /></Field></div><Field label="Program Name *"><input className="form-control" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required /></Field><Field label="Description"><textarea className="form-control" rows="3" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} /></Field></div><Footer submitting={submitting} label={editing ? 'Save Changes' : 'Create Program'} onClose={onClose} /></form>
  </Modal>;
}

function Modal({ title, icon, onClose, busy, children }) { return <ModalBackdrop onClose={onClose} busy={busy}><div className="modal-card modal-md"><div className="modal-header"><h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{icon}{title}</h3><button type="button" className="btn btn-icon btn-outline btn-sm" aria-label="Close" data-modal-close onClick={onClose} style={{ padding: '4px', border: 'none', background: 'none' }}><X size={18} /></button></div>{children}</div></ModalBackdrop>; }
function Field({ label, children }) { return <div className="form-group"><label className="form-label">{label}</label>{children}</div>; }
function Footer({ submitting, label, onClose }) { return <div className="modal-footer" style={{ padding: '14px 22px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}><button type="button" className="btn btn-outline" data-modal-close onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving...' : label}</button></div>; }
