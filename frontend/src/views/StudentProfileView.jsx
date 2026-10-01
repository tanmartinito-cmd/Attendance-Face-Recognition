import React, { useState, useEffect } from 'react';
import { PageLoader } from '../ui';
import { User, Camera, CheckCircle, GraduationCap, IdCard, KeyRound, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { Api, resolveMediaUrl } from '../api';
import Toast from '../components/shared/Toast';
import PhoneInput from '../components/shared/PhoneInput';
import Avatar from '../components/shared/Avatar';
import ChangePasswordCard from '../components/shared/ChangePasswordCard';
import TwoFactorCard from '../components/shared/TwoFactorCard';
import Tabs, { TabPanel } from '../components/shared/Tabs';

const STUDENT_TABS = [
  { id: 'personal', label: 'Personal', icon: User },
  { id: 'contact', label: 'Contact & address', icon: MapPin },
  { id: 'academic', label: 'Academic', icon: GraduationCap },
  { id: 'security', label: 'Security', icon: KeyRound },
];

/** Student profile, grouped into tabs. */
export default function StudentProfileView({ onUserUpdated, onSetHeaderInfo, onSignedOut }) {
  const [tab, setTab] = useState('personal');
  const [editing, setEditing] = useState(false);
  const ph = (example) => (editing ? example : 'Not provided');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [profile, setProfile] = useState(null);
  const [formData, setFormData] = useState({});

  useEffect(() => {
    loadProfile();
  }, []);

  // Personal and contact tabs are editable; Academic is read-only; Security has its own forms.
  const canEdit = tab === 'personal' || tab === 'contact';
  const changeTab = (next) => {
    if (editing) { setEditing(false); loadProfile(); } // leaving a tab cancels unsaved edits
    setTab(next);
  };

  useEffect(() => {
    if (onSetHeaderInfo) {
      onSetHeaderInfo({
        title: 'My Profile',
        subtitle: 'Your personal information, academic details, and account security',
        headerActions: !editing && canEdit ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditing(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>Edit Profile</span>
          </button>
        ) : null,
      });
    }
  }, [onSetHeaderInfo, editing, canEdit]);

  async function loadProfile() {
    try {
      setLoading(true);
      const data = await Api.getMe();
      setProfile(data);
      setFormData({
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        email: data.email || '',
        phone: data.phone || '',
        middle_name: data.student_profile?.middle_name || '',
        birth_date: data.student_profile?.birth_date || '',
        birth_place: data.student_profile?.birth_place || '',
        gender: data.student_profile?.gender || 'Male',
        civil_status: data.student_profile?.civil_status || 'Single',
        religion: data.student_profile?.religion || '',
        citizenship: data.student_profile?.citizenship || '',
        blood_type: data.student_profile?.blood_type || '',
        height: data.student_profile?.height || '',
        languages_spoken: data.student_profile?.languages_spoken || '',
        current_address: data.student_profile?.current_address || '',
        current_region: data.student_profile?.current_region || '',
        current_province: data.student_profile?.current_province || '',
        current_municipality: data.student_profile?.current_municipality || '',
        permanent_address: data.student_profile?.permanent_address || '',
        permanent_region: data.student_profile?.permanent_region || '',
        permanent_province: data.student_profile?.permanent_province || '',
        permanent_municipality: data.student_profile?.permanent_municipality || '',
        mobile_number: data.student_profile?.mobile_number || '',
        telephone: data.student_profile?.telephone || '',
      });
    } catch (err) {
      setErrorMsg('Failed to load profile');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      setLoading(true);
      setErrorMsg('');
      const updated = await Api.updateProfile(formData);
      onUserUpdated?.(updated);
      setSuccessMsg('Profile updated successfully!');
      setEditing(false);
      await loadProfile();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  }

  const faceImageUrl = resolveMediaUrl(profile?.student_profile?.face_image || profile?.profile_image);
  const fullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || profile?.username;

  if (!profile) {
    return <div className="page-content"><PageLoader label="Loading your profile…" /></div>;
  }

  const field = (key) => ({
    value: formData[key] ?? '',
    onChange: (e) => setFormData({ ...formData, [key]: e.target.value }),
    disabled: !editing,
  });
  const yearLevel = profile.student_profile?.year_level || 1;

  return (
    <div className="page-content profile-page">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      <section className="profile-hero">
        <Avatar src={faceImageUrl} name={fullName} size={68} ring alt="Profile photo" />
        <div className="profile-hero-copy">
          <span className="badge badge-accent"><GraduationCap size={13} /> Student profile</span>
          <h2>{fullName}</h2>
          <p>{profile.student_profile?.display_academic_program || profile.student_profile?.course || 'Program not set'} · Year {yearLevel}</p>
          <div className="profile-identity-row">
            <span><IdCard size={14} /> {profile.student_profile?.student_id || 'Student ID pending'}</span>
            <span><Mail size={14} /> {profile.email || 'No email set'}</span>
          </div>
        </div>
      </section>

      <Tabs idPrefix="student-profile" label="Profile sections" tabs={STUDENT_TABS} active={tab} onChange={changeTab} />

      {tab !== 'security' && (
        <form onSubmit={handleSave}>
          <TabPanel idPrefix="student-profile" id="personal" active={tab}>
            <div className="tab-panel-grid">
              <div className="card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><User size={16} /> Basic information</span>
                </div>
                <div className="card-body">
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group"><label className="form-label">First Name *</label><input type="text" className="form-control" {...field('first_name')} required /></div>
                    <div className="form-group"><label className="form-label">Last Name *</label><input type="text" className="form-control" {...field('last_name')} required /></div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Middle Name</label><input type="text" className="form-control" {...field('middle_name')} /></div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><ShieldCheck size={16} /> Personal details</span>
                </div>
                <div className="card-body">
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group"><label className="form-label">Date of Birth</label><input type="date" className="form-control" {...field('birth_date')} /></div>
                    <div className="form-group"><label className="form-label">Place of Birth</label><input type="text" className="form-control" {...field('birth_place')} /></div>
                    <div className="form-group"><label className="form-label">Gender</label><select className="form-select" {...field('gender')}><option>Male</option><option>Female</option></select></div>
                    <div className="form-group"><label className="form-label">Civil Status</label><select className="form-select" {...field('civil_status')}><option>Single</option><option>Married</option><option>Widowed</option><option>Separated</option></select></div>
                    <div className="form-group"><label className="form-label">Religion</label><input type="text" className="form-control" {...field('religion')} /></div>
                    <div className="form-group"><label className="form-label">Citizenship</label><input type="text" className="form-control" {...field('citizenship')} /></div>
                    <div className="form-group"><label className="form-label">Blood Type</label><input className="form-control" {...field('blood_type')} placeholder={ph('e.g. O+')} /></div>
                    <div className="form-group"><label className="form-label">Height</label><input className="form-control" {...field('height')} placeholder={ph('e.g. 165 cm')} /></div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Languages Spoken</label><input className="form-control" {...field('languages_spoken')} placeholder={ph('e.g. English, Filipino, Cebuano')} /></div>
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel idPrefix="student-profile" id="contact" active={tab}>
            <div className="tab-panel-grid">
              <div className="card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Phone size={16} /> Contact information</span>
                </div>
                <div className="card-body">
                  <div className="form-group" style={{ marginBottom: '14px' }}><label className="form-label">Email Address *</label><input type="email" className="form-control" {...field('email')} required /></div>
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label">Mobile Number</label>
                    <PhoneInput value={formData.mobile_number} onChange={(e) => setFormData({ ...formData, mobile_number: e.target.value })} disabled={!editing} />
                  </div>
                  <div className="form-group"><label className="form-label">Telephone / Landline</label><input type="text" className="form-control" {...field('telephone')} /></div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><MapPin size={16} /> Addresses</span>
                </div>
                <div className="card-body">
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label">Current Address</label>
                    <textarea className="form-control" rows={3} {...field('current_address')} placeholder={ph('House#/Street Name, Barangay, City, Province')} />
                  </div>
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Permanent Address</label><textarea className="form-control" rows={3} {...field('permanent_address')} placeholder={ph('House#/Street Name, Barangay, City, Province')} /></div>
                    <div className="form-group"><label className="form-label">Permanent Region</label><input className="form-control" {...field('permanent_region')} /></div>
                    <div className="form-group"><label className="form-label">Permanent Province</label><input className="form-control" {...field('permanent_province')} /></div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Permanent City / Municipality</label><input className="form-control" {...field('permanent_municipality')} /></div>
                  </div>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel idPrefix="student-profile" id="academic" active={tab}>
            <div className="tab-panel-grid">
              <div className="card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><GraduationCap size={16} /> Academic information</span>
                </div>
                <div className="card-body">
                  <div className="alert alert-warning" style={{ fontSize: '12px', marginBottom: '14px' }}>
                    Academic information can only be updated by administrators.
                  </div>
                  <div className="grid-2" style={{ gap: '14px' }}>
                    <div className="form-group"><label className="form-label">Student ID</label><input type="text" className="form-control" value={profile.student_profile?.student_id || ''} disabled /></div>
                    <div className="form-group"><label className="form-label">Username</label><input type="text" className="form-control" value={profile.username || ''} disabled /></div>
                    <div className="form-group"><label className="form-label">Program</label><input type="text" className="form-control" value={profile.student_profile?.display_academic_program || profile.student_profile?.course || ''} disabled /></div>
                    <div className="form-group"><label className="form-label">Year Level</label><input type="text" className="form-control" value={`${yearLevel}${['st', 'nd', 'rd', 'th'][Math.min(3, yearLevel - 1)]} Year`} disabled /></div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Camera size={16} /> Face enrollment</span>
                </div>
                <div className="card-body">
                  {profile.student_profile?.is_face_enrolled ? (
                    <div className="alert alert-success">
                      <CheckCircle size={16} style={{ marginRight: '8px' }} />
                      Face enrolled
                      {profile.student_profile?.face_enrolled_at && (
                        <div className="text-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                          Enrolled on {new Date(profile.student_profile.face_enrolled_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="alert alert-warning">
                      <Camera size={16} style={{ marginRight: '8px' }} />
                      Face not enrolled yet. Ask your administrator to enroll your face.
                    </div>
                  )}
                  <p className="text-muted" style={{ fontSize: '12px', margin: '10px 0 0' }}>
                    Your profile photo comes from face enrollment and can only be changed by an administrator.
                  </p>
                </div>
              </div>
            </div>
          </TabPanel>

          {editing && (
            <div className="profile-save-bar">
              <button type="button" className="btn btn-outline" onClick={() => { setEditing(false); loadProfile(); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save Changes'}</button>
            </div>
          )}
        </form>
      )}

      <TabPanel idPrefix="student-profile" id="security" active={tab}>
        <div className="tab-panel-grid">
          <ChangePasswordCard onSignedOut={onSignedOut} />
          <TwoFactorCard />
        </div>
      </TabPanel>
    </div>
  );
}
