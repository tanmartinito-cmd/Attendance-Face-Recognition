import React from 'react';
import { Calendar, CheckCircle, FileText, Activity } from 'lucide-react';
import ActionPopover from '../shared/ActionPopover';

/**
 * SessionsTable - Recent attendance sessions table
 * Used by admin and instructor dashboards
 */
export default function SessionsTable({ sessions, sections, onNavigate, title = 'Recent Attendance Activity', limit = 5 }) {
  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={16} /> {title}
        </span>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => onNavigate('session_logs')}
        >
          View All
        </button>
      </div>

      <div className="table-container" style={{ border: 'none' }}>
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>Subject</th>
              <th>Instructor</th>
              <th>Date</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Report</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan="6" className="text-center text-muted" style={{ padding: '28px' }}>
                  No attendance sessions recorded yet.
                </td>
              </tr>
            ) : (
              sessions.slice(0, limit).map((session) => {
                const secName =
                  session.section_name ||
                  session.schedule_details?.section_name ||
                  (typeof session.schedule === 'object' ? session.schedule?.section_name : null) ||
                  (sections.find((s) => s.id === (session.schedule_details?.section || session.schedule))?.name) ||
                  'Section';

                const subjCode =
                  session.subject_code ||
                  session.schedule_details?.subject_code ||
                  (typeof session.schedule === 'object' ? session.schedule?.subject_code : null) ||
                  (sections.find((s) => s.id === (session.schedule_details?.section || session.schedule))?.effective_subject_code) ||
                  '—';

                const subjName =
                  session.subject_name ||
                  session.schedule_details?.subject_name ||
                  (typeof session.schedule === 'object' ? session.schedule?.subject_name : null) ||
                  (sections.find((s) => s.id === (session.schedule_details?.section || session.schedule))?.effective_subject_name) ||
                  '';

                const teacherName =
                  session.started_by_name ||
                  session.instructor_name ||
                  session.schedule_details?.instructor_name ||
                  '—';

                const formattedDate = session.date
                  ? new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—';

                return (
                  <tr key={session.id}>
                    <td>
                      <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--text-primary)' }}>
                        {secName}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <div>
                          <span
                            className="badge badge-accent"
                            style={{
                              fontWeight: 700,
                              fontSize: '11px',
                              padding: '2px 8px',
                              letterSpacing: '0.3px',
                              background: 'var(--accent-light)',
                              color: 'var(--accent)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            {subjCode}
                          </span>
                        </div>
                        {subjName && (
                          <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                            {subjName}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="text-muted" style={{ fontSize: '13px' }}>
                      {teacherName}
                    </td>
                    <td style={{ fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        <Calendar size={13} style={{ color: 'var(--text-muted)' }} />
                        <span>{formattedDate}</span>
                      </div>
                    </td>
                    <td>
                      {session.status === 'open' ? (
                        <span
                          className="badge badge-success"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontWeight: 700,
                            fontSize: '11px',
                            padding: '3px 9px',
                            background: 'rgba(16, 185, 129, 0.1)',
                            color: '#059669',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                          }}
                        >
                          <span className="pulse-dot" style={{ background: '#10b981', width: '6px', height: '6px' }} />
                          Live
                        </span>
                      ) : (
                        <span
                          className="badge badge-muted"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: 600,
                            fontSize: '11px',
                            padding: '3px 9px',
                            background: 'rgba(100, 116, 139, 0.08)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <CheckCircle size={11} style={{ opacity: 0.7 }} /> Finalized
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <ActionPopover
                        items={[
                          {
                            label: 'Session Report',
                            icon: FileText,
                            onClick: () => onNavigate('session_logs'),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
