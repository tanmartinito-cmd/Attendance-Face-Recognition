import React, { useState, useEffect } from 'react';
import { TableLoadingRow, usePageLoading } from '../ui';
import {
  Camera,
  CircleDot,
  FileText,
  BookOpen,
  
  Clock,
  User as UserIcon,
  CheckCircle,
  XCircle,
  BookX,
  List,
} from 'lucide-react';
import { Api } from '../api';
import { formatSchoolScheduleParts } from '../utils/time';
import ActionPopover from '../components/shared/ActionPopover';
import StudentAttendanceCalendarModal from '../components/StudentAttendanceCalendarModal';

export default function ReportsView({ user, onNavigate, onStartSession, onSetHeaderInfo }) {
  const role = user?.role || 'admin';
  const isStudent = role === 'student';

  // Teacher / Admin sessions
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = usePageLoading(() => loadData());

  // Student-specific data
  const [studentOverview, setStudentOverview] = useState(null);
  const [selectedCalendarSection, setSelectedCalendarSection] = useState(null);

  async function loadData() {
    try {
      setLoading(true);
      if (isStudent) {
        const overview = await Api.getStudentAttendanceOverview();
        setStudentOverview(overview);
      } else {
        const data = await Api.getSessions();
        setSessions(data || []);
      }
    } catch (err) {
      console.error('Failed to load records:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [isStudent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (onSetHeaderInfo) {
      if (isStudent) {
        onSetHeaderInfo({
          title: 'My Attendance Records',
          subtitle: 'Your enrolled subjects and attendance performance',
          headerActions: null,
        });
      } else {
        onSetHeaderInfo({
          title: 'Session Logs',
          subtitle: 'Past attendance sessions and verified scan logs',
          headerActions: null,
        });
      }
    }
  }, [isStudent, onSetHeaderInfo]);

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: STUDENT ATTENDANCE RECORDS (100% copycat of templates/core/attendance_history_student.html)
  // ══════════════════════════════════════════════════════════════════════════
  if (isStudent) {
    const cards = studentOverview?.enrolled_cards || [];
    const stats = studentOverview?.overall_stats || { rate: 0, total_sessions: 0, present: 0, late: 0, absent: 0, excused: 0 };
    const logs = studentOverview?.recent_records || [];

    return (
      <div className="page-content">
        {/* Overall Metric Summary */}
        <div
          className="stats-grid mb-3"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <div className="stat-card green" style={{ padding: '14px 16px' }}>
            <div className="stat-info">
              <div className="value" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--success)' }}>
                {stats.rate}%
              </div>
              <div className="label" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                Overall Rate
              </div>
            </div>
          </div>

          <div className="stat-card blue" style={{ padding: '14px 16px' }}>
            <div className="stat-info">
              <div className="value" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--info)' }}>
                {stats.total_sessions}
              </div>
              <div className="label" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                Total Sessions
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ padding: '14px 16px', background: '#ecfdf5', borderLeft: '4px solid #10b981' }}>
            <div className="stat-info">
              <div className="value" style={{ fontSize: '24px', fontWeight: 700, color: '#10b981' }}>
                {stats.present}
              </div>
              <div className="label" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                Present Days
              </div>
            </div>
          </div>

          <div className="stat-card orange" style={{ padding: '14px 16px' }}>
            <div className="stat-info">
              <div className="value" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--warning)' }}>
                {stats.late}
              </div>
              <div className="label" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                Late Days
              </div>
            </div>
          </div>

          <div className="stat-card" style={{ padding: '14px 16px', background: 'var(--danger-light)', borderLeft: '4px solid var(--danger)' }}>
            <div className="stat-info">
              <div className="value" style={{ fontSize: '24px', fontWeight: 700, color: 'var(--danger)' }}>
                {stats.absent}
              </div>
              <div className="label" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                Absent Days
              </div>
            </div>
          </div>
        </div>

        {/* ══ ENROLLED CLASSES: Section (Subject Name) Cards ═════════════════════════ */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <BookOpen style={{ width: '18px', height: '18px', color: 'var(--primary)' }} />
              <span>Enrolled Classes</span>
            </h3>
            <span className="text-muted" style={{ fontSize: '13px' }}>
              Click <strong>View Attendance</strong> to view monthly calendar and records
            </span>
          </div>

          {loading ? (
            <div className="card" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading enrolled classes and attendance...
            </div>
          ) : cards.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                gap: '16px',
              }}
            >
              {cards.map((card) => (
                <div
                  key={card.section_id}
                  className="card"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      padding: '14px 18px',
                      borderBottom: '1px solid var(--border)',
                      background: 'var(--bg-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span className="badge badge-accent" style={{ fontWeight: 700, fontSize: '11px' }}>
                      {card.subject_code}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {card.section_name}
                    </span>
                  </div>

                  <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {card.title}
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <UserIcon size={14} style={{ color: 'var(--text-muted)' }} />
                        <span>{card.teacher_name}</span>
                      </div>
                      {(() => {
                        const schedParts = formatSchoolScheduleParts(card.schedule_display);
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            {(schedParts.timeLines && schedParts.fullTime !== 'No schedule set'
                              ? schedParts.timeLines
                              : [schedParts.fullTime !== 'No schedule set' ? schedParts.fullTime : 'Standard Schedule']
                            ).map((tl, tIdx) => (
                              <span key={tIdx} style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                {tl}
                              </span>
                            ))}
                            {schedParts.room && (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {schedParts.room}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
                      {card.rate !== null && card.rate !== undefined ? (
                        <div
                          style={{
                            background: '#ecfdf5',
                            border: '1px solid #a7f3d0',
                            borderRadius: 'var(--radius)',
                            padding: '8px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                          }}
                        >
                          <span style={{ fontWeight: 700, color: '#065f46' }}>{card.rate}% Rate</span>
                          <span style={{ color: '#047857' }}>({card.present_count} Present, {card.late_count} Late)</span>
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '12px' }}>No sessions logged yet</span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '12px 18px',
                      borderTop: '1px solid var(--border)',
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-outline btn-sm w-100"
                      onClick={() => setSelectedCalendarSection(card)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        fontWeight: 600,
                      }}
                    >
                      <span>View Attendance</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <BookX style={{ width: '40px', height: '40px', margin: '0 auto 12px auto', opacity: 0.5 }} />
              <p style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0', color: 'var(--text-primary)' }}>
                You are not currently enrolled in any classes.
              </p>
              <p style={{ fontSize: '13px', margin: 0 }}>
                Please contact your administrator or instructor to be added to your class section.
              </p>
            </div>
          )}
        </div>

        {/* ══ RECENT ATTENDANCE SESSION LOGS ══════════════════════════════════════════ */}
        <div className="card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div
            className="card-header"
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700 }}>
              <List size={16} style={{ color: 'var(--primary)' }} /> Recent Attendance Verification Logs
            </span>
            <span className="text-muted" style={{ fontSize: '12px' }}>
              Showing recent recognized scans
            </span>
          </div>

          <div className="table-container" style={{ border: 'none', margin: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Date</th>
                  <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Subject</th>
                  <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Section</th>
                  <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Time In</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No attendance scans logged yet. Records appear when your instructor starts a class session.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '14px 18px', fontWeight: 600 }}>{log.date}</td>
                      <td style={{ padding: '14px 18px' }}>
                        <span className="badge badge-accent" style={{ fontSize: '11px', fontWeight: 700 }}>
                          {log.subject_code}
                        </span>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {log.subject_name}
                        </div>
                      </td>
                      <td style={{ padding: '14px 18px', fontWeight: 600 }}>{log.section_name}</td>
                      <td style={{ padding: '14px 18px' }}>
                        {log.status === 'present' ? (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <CheckCircle size={11} /> Present
                          </span>
                        ) : log.status === 'late' ? (
                          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={11} /> Late
                          </span>
                        ) : (
                          <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <XCircle size={11} /> Absent
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 18px', color: 'var(--text-muted)', fontSize: '13px' }}>
                        {log.time}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ══ In-Page Modal: Student Attendance Calendar & Summary ════════════ */}
        {selectedCalendarSection && (
          <StudentAttendanceCalendarModal
            isOpen={Boolean(selectedCalendarSection)}
            onClose={() => setSelectedCalendarSection(null)}
            sectionId={selectedCalendarSection.section_id}
            initialTitle={selectedCalendarSection.title}
            initialSubject={selectedCalendarSection.subject_name}
            initialInstructor={selectedCalendarSection.teacher_name}
          />
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW: TEACHER & ADMIN SESSION LOGS TABLE
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="page-content">
      <div className="card" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div className="table-container" style={{ border: 'none', margin: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Date</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Section</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Subject</th>
                {role !== 'teacher' && (
                  <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Faculty</th>
                )}
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '12px 18px', fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={role !== 'teacher' ? 6 : 5} label="Loading session records…" />
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={role !== 'teacher' ? 6 : 5} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No sessions logged yet.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '14px 18px', fontWeight: '600', color: 'var(--text-primary)' }}>
                      {s.date}
                    </td>
                    <td style={{ padding: '14px 18px', fontWeight: '700' }}>
                      {s.schedule_details?.section_name || 'Class Section'}
                    </td>
                    <td style={{ padding: '14px 18px' }}>
                      <span className="badge badge-accent" style={{ fontSize: '11px', fontWeight: '700' }}>
                        {s.schedule_details?.subject_code || 'CS 101'}
                      </span>
                    </td>
                    {role !== 'teacher' && (
                      <td style={{ padding: '14px 18px', color: 'var(--text-muted)', fontSize: '13px' }}>
                        {s.started_by_name || '—'}
                      </td>
                    )}
                    <td style={{ padding: '14px 18px' }}>
                      {s.status === 'open' ? (
                        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: '700' }}>
                          <CircleDot size={10} /> Open
                        </span>
                      ) : (
                        <span className="badge badge-muted" style={{ fontSize: '11px', fontWeight: '600' }}>
                          Closed
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '14px 18px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <ActionPopover
                        items={(() => {
                          const items = [];
                          // ONLY TEACHERS CAN ACCESS ATTENDANCE SCANNER
                          if (role === 'teacher' && s.status === 'open') {
                            items.push({
                              label: 'Resume Scanner',
                              icon: Camera,
                              isPrimary: true,
                              onClick: () => {
                                if (onStartSession) onStartSession(s);
                                else if (onNavigate) onNavigate('scanner');
                              },
                            });
                            items.push({ isDivider: true });
                          }
                          items.push({
                            label: 'Session Report',
                            icon: FileText,
                            onClick: () => {
                              if (onNavigate) onNavigate('section_report');
                            },
                          });
                          return items;
                        })()}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
