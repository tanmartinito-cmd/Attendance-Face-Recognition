import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
} from 'lucide-react';
import { Api, apiRequest } from '../api';
import Toast from '../components/shared/Toast';
import UserTableRow from '../components/users/UserTableRow';
import AddUserModal from '../components/users/AddUserModal';
import EditUserModal from '../components/users/EditUserModal';
import { getPhPhoneValidationMessage, checkPasswordCriteria } from '../utils/validation';
import { confirmAction, TableLoadingRow, usePageLoading } from '../ui';

const COURSE_TO_PROGRAM = {
  BSIT: 'CITEC',
  BSCS: 'CITEC',
  BSEMC: 'CITEC',
  BSCRIM: 'CCJE',
  BSA: 'CoA',
  BSBA: 'CORE',
  BSHM: 'CIHT',
  BSTM: 'CIHT',
  BSN: 'CoN',
  BSED: 'CTE',
  BEED: 'CTE',
  BSCE: 'CEnTech',
  BSCpE: 'CEnTech',
  AB: 'CAS',
};

export default function UsersView({ user, onNavigate, onSetHeaderInfo }) {
  const [users, setUsers] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = usePageLoading(() => loadUsers());
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);

  // Edit User State
  const [editingUser, setEditingUser] = useState(null);
  const [editFormData, setEditFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    is_active: true,
    department: '',
    specialization: '',
    employee_id: '',
    course: '',
    course_ref: '',
    program_id: '',
    year_level: 1,
    student_id: '',
    password: '',
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Form State
  const [formData, setFormData] = useState({
    username: '',
    role: 'teacher',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    confirm_password: '',
    employee_id: '',
    department: '',
    specialization: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    loadUsers();
    loadPrograms();
  }, []);

  useEffect(() => {
    if (onSetHeaderInfo) {
      onSetHeaderInfo({
        title: 'Users',
        subtitle: 'System users, faculty, staff and students',
        headerActions: (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onNavigate && onNavigate('student_enrollment')}
            >
              Enroll student
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAddModal(true)}
            >
              Add staff account
            </button>
          </div>
        ),
      });
    }
  }, [onSetHeaderInfo]);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await Api.getUsers();
      setUsers(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadPrograms() {
    try {
      const res = await apiRequest('/api/programs/');
      if (res.ok) {
        const [programData, courseData] = await Promise.all([Api.getPrograms(), Api.getCourses()]);
        setPrograms(programData || []);
        setCourses(courseData || []);
      }
    } catch {
      // Fallback official programs if API is not yet loaded
      setPrograms([
        { id: 1, code: 'CITEC', name: 'College of Information, Technology, Entertainment, and Computing' },
        { id: 2, code: 'CCJE', name: 'College of Criminal Justice Education' },
        { id: 3, code: 'CTE', name: 'College of Teacher Education' },
        { id: 4, code: 'CoA', name: 'College of Accountancy' },
        { id: 5, code: 'CoN', name: 'College of Nursing' },
        { id: 6, code: 'CAS', name: 'College of Arts and Sciences' },
        { id: 7, code: 'CORE', name: 'College of Operations, Resources, and Entrepreneurship' },
        { id: 8, code: 'CEnTech', name: 'College of Engineering and Technology' },
        { id: 9, code: 'CIHT', name: 'College of Innovative Hospitality and Tourism' },
      ]);
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault();
    // Faculty username = Faculty ID (set by the server); only admins type a username.
    if ((formData.role === 'admin' && !formData.username?.trim()) || !formData.first_name || !formData.last_name || !formData.email || !formData.password) {
      setFormError('Please fill in all required fields.');
      return;
    }

    if (formData.phone) {
      const phoneErr = getPhPhoneValidationMessage(formData.phone);
      if (phoneErr) {
        setFormError(phoneErr);
        return;
      }
    }

    const pwdCheck = checkPasswordCriteria(formData.password);
    if (!pwdCheck.isStrong) {
      const missing = pwdCheck.criteria.filter((c) => !c.met).map((c) => c.label).join(', ');
      setFormError(`Password does not meet requirements: ${missing}`);
      return;
    }

    if (formData.password !== formData.confirm_password) {
      setFormError('Passwords do not match.');
      return;
    }

    setFormLoading(true);
    setFormError('');

    try {
      const created = await Api.createUser(formData);
      const loginId = created?.username || (formData.role === 'admin' ? formData.username.trim() : formData.employee_id?.trim());
      setSuccessMsg(`User ${formData.first_name} ${formData.last_name} (${formData.role}) created! Sign-in username: "${loginId}".`);
      setShowAddModal(false);
      setFormData({
        username: '',
        role: 'teacher',
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        password: '',
        confirm_password: '',
        employee_id: '',
        department: '',
        specialization: '',
      });
      await loadUsers();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setFormError(err.message || 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  };

  const handleOpenEditModal = (u) => {
    setEditingUser(u);
    setEditError('');
    const rawCourse = u.student_profile?.course || 'BSIT';
    const courseDetails = u.student_profile?.course_details;
    const inferredProg = courseDetails?.program_code || u.student_profile?.program_code || COURSE_TO_PROGRAM[rawCourse] || 'CITEC';
    const inferredProgramId = courseDetails?.program_id || courses.find((course) => String(course.id) === String(u.student_profile?.course_ref || courseDetails?.id))?.program || '';
    setEditFormData({
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      email: u.email || '',
      phone: u.phone || '',
      is_active: u.is_active !== undefined ? Boolean(u.is_active) : true,
      department: u.teacher_profile?.department || '',
      specialization: u.teacher_profile?.specialization || '',
      employee_id: u.teacher_profile?.employee_id || '',
      title: u.teacher_profile?.title || '',
      date_hired: u.teacher_profile?.date_hired || '',
      employment_status: u.teacher_profile?.employment_status || 'Regular',
      position: u.teacher_profile?.position || '',
      contact_number: u.teacher_profile?.contact_number || '',
      office_location: u.teacher_profile?.office_location || '',
      consultation_hours: u.teacher_profile?.consultation_hours || '',
      education_background: u.teacher_profile?.education_background || '',
      certifications: u.teacher_profile?.certifications || '',
      program: inferredProg,
      program_id: inferredProgramId,
      course: rawCourse,
      course_ref: u.student_profile?.course_ref || u.student_profile?.course_details?.id || '',
      year_level: u.student_profile?.year_level || 1,
      student_id: u.student_profile?.student_id || '',
      // Additional student fields from registration form
      middle_name: u.student_profile?.middle_name || '',
      birth_date: u.student_profile?.birth_date || '',
      birth_place: u.student_profile?.birth_place || '',
      gender: u.student_profile?.gender || 'Male',
      civil_status: u.student_profile?.civil_status || 'Single',
      religion: u.student_profile?.religion || '',
      citizenship: u.student_profile?.citizenship || '',
      current_address: u.student_profile?.current_address || '',
      mobile_number: u.student_profile?.mobile_number || '',
      telephone: u.student_profile?.telephone || '',
      password: '',
    });
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    if (!editingUser) return;

    if (editFormData.phone) {
      const phoneErr = getPhPhoneValidationMessage(editFormData.phone);
      if (phoneErr) {
        setEditError(phoneErr);
        return;
      }
    }

    if (editFormData.password) {
      const pwdCheck = checkPasswordCriteria(editFormData.password);
      if (!pwdCheck.isStrong) {
        const missing = pwdCheck.criteria.filter((c) => !c.met).map((c) => c.label).join(', ');
        setEditError(`New password does not meet requirements: ${missing}`);
        return;
      }
    }

    try {
      setEditLoading(true);
      setEditError('');
      const payload = { ...editFormData };
      const isPasswordChanged = Boolean(payload.password && payload.password.trim());
      if (!isPasswordChanged) {
        delete payload.password;
      }
      delete payload.program; // Clean up UI-only field

      // Clean up role-specific fields
      if (editingUser.role === 'student') {
        // Remove teacher-only fields when editing students
        delete payload.employee_id;
        delete payload.department;
        delete payload.specialization;
        delete payload.title;
        delete payload.date_hired;
        delete payload.employment_status;
        delete payload.position;
        delete payload.contact_number;
        delete payload.office_location;
        delete payload.consultation_hours;
        delete payload.education_background;
        delete payload.certifications;
        // Convert empty date strings to null
        if (payload.birth_date === '') {
          payload.birth_date = null;
        }
      } else if (editingUser.role === 'teacher') {
        // Remove student-only fields when editing teachers
        delete payload.student_id;
        delete payload.year_level;
        delete payload.course;
        delete payload.course_ref;
        delete payload.program_id;
        delete payload.middle_name;
        delete payload.birth_date;
        delete payload.birth_place;
        delete payload.gender;
        delete payload.civil_status;
        delete payload.religion;
        delete payload.citizenship;
        delete payload.current_address;
        delete payload.mobile_number;
        delete payload.telephone;
        // Convert empty date strings to null
        if (payload.date_hired === '') {
          payload.date_hired = null;
        }
      }

      if (payload.course_ref) payload.course_ref = Number(payload.course_ref);

      await Api.updateUser(editingUser.id, payload);
      const pwdNote = isPasswordChanged ? ' (Password updated)' : '';
      setSuccessMsg(`User "${editingUser.username}" updated successfully!${pwdNote}`);
      setEditingUser(null);
      await loadUsers();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setEditError(err.message || 'Failed to update user.');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteUser = async (u) => {
    const displayName = u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.username;
    await confirmAction({
      title: 'Delete this user?',
      message: `${displayName} (@${u.username}) and their access will be permanently removed. This cannot be undone.`,
      details: 'Tip: deactivate the account instead if you may need it again.',
      confirmLabel: 'Delete user',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await Api.deleteUser(u.id);
          setSuccessMsg(`User "${displayName}" deleted.`);
          await loadUsers();
        } catch (err) {
          setErrorMsg(err.message || 'Failed to delete user.');
        }
      },
    });
  };

  const handleToggleStatus = async (u, nextActive) => {
    const displayName = u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.username;
    if (!nextActive && (u.id === user?.id || u.username === user?.username)) {
      setErrorMsg('You cannot deactivate your own administrative account.');
      setTimeout(() => setErrorMsg(''), 4000);
      return;
    }

    try {
      await Api.updateUser(u.id, { is_active: nextActive });
      setSuccessMsg(`User "${displayName}" (@${u.username}) is now ${nextActive ? 'Active' : 'Inactive'}.`);
      await loadUsers();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update user status.');
      setTimeout(() => setErrorMsg(''), 4000);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      u.username?.toLowerCase().includes(q) ||
      u.first_name?.toLowerCase().includes(q) ||
      u.last_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q);
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="page-content">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      {/* Filter Tabs & Search Bar */}
      <div className="card" style={{ padding: '16px', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 'var(--radius)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {['all', 'admin', 'teacher', 'student'].map((r) => (
              <button
                key={r}
                type="button"
                className={`btn btn-sm ${roleFilter === r ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setRoleFilter(r)}
                style={{ textTransform: 'capitalize', padding: '6px 12px' }}
              >
                {r === 'all' ? 'All Roles' : `${r}s`}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-control filter-control"
              placeholder="Search user by name, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: '34px', width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="card" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Profile Info</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                <TableLoadingRow colSpan={7} label="Loading users…" />
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="7" className="table-empty-cell">
                    <strong>{users.length === 0 ? 'No users yet' : 'No users match your filters'}</strong>
                    {users.length === 0
                      ? 'Add a staff account or enroll a student to get started.'
                      : 'Try a different name or email, or switch the role filter back to All Roles.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <UserTableRow
                    key={u.id || u.username}
                    user={u}
                    currentUser={user}
                    onEdit={handleOpenEditModal}
                    onToggleStatus={handleToggleStatus}
                    onDelete={handleDeleteUser}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── ADD STAFF / FACULTY MODAL ─── */}
      <AddUserModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleCreateUser}
        formData={formData}
        setFormData={setFormData}
        programs={programs}
        submitting={formLoading}
        errorMsg={formError}
      />

      {/* ─── EDIT USER MODAL ─── */}
      <EditUserModal
        isOpen={!!editingUser}
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSubmit={handleUpdateUser}
        formData={editFormData}
        setFormData={setEditFormData}
        programs={programs}
        courses={courses}
        submitting={editLoading}
        errorMsg={editError}
      />
    </div>
  );
}
