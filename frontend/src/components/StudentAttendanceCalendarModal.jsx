import React, { useState, useEffect } from 'react';
import {
  CalendarCheck,
  Calendar,
  X,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Api } from '../api';
import { PageLoader } from '../ui';

export default function StudentAttendanceCalendarModal({
  isOpen,
  onClose,
  sectionId,
  initialTitle,
  initialSubject,
  initialInstructor,
  studentId = null,
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    if (!isOpen || !sectionId) return;

    let isMounted = true;
    async function fetchCalendar() {
      try {
        setLoading(true);
        const res = await Api.getStudentAttendanceCalendar(sectionId, year, month, studentId);
        if (isMounted) {
          setData(res);
        }
      } catch (err) {
        console.error('Failed to load student attendance calendar:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchCalendar();
    return () => {
      isMounted = false;
    };
  }, [isOpen, sectionId, year, month, studentId]);

  // Reset when section changes or closes
  useEffect(() => {
    if (isOpen) {
      setYear(null);
      setMonth(null);
      setSelectedDay(null);
    }
  }, [isOpen, sectionId]);

  if (!isOpen) return null;

  const handlePrevMonth = () => {
    if (data?.prev_year && data?.prev_month) {
      setYear(data.prev_year);
      setMonth(data.prev_month);
    }
  };

  const handleNextMonth = () => {
    if (data?.next_year && data?.next_month) {
      setYear(data.next_year);
      setMonth(data.next_month);
    }
  };

  const sessionLogs = data?.session_logs || data?.records || [];

  return (
    <div
      className="modal-backdrop"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        className="modal-card"
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
          width: '100%',
          maxWidth: '1120px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          className="modal-header"
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-secondary)',
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-primary)',
              }}
            >
              <CalendarCheck style={{ color: 'var(--primary)', width: 22, height: 22 }} />
              <span>
                {data ? `${data.section_name} (${data.subject_code})` : initialTitle || 'Class Attendance'}
              </span>
            </h3>
            <div
              style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '3px' }}
            >
              {data
                ? `${data.subject_name} • Instructor: ${data.instructor_name} • ${data.schedule_display || 'Scheduled Class Meeting'}`
                : initialSubject ? `${initialSubject} • Instructor: ${initialInstructor || 'Assigned Faculty'}` : 'Loading class records...'}
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '6px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div
          className="modal-body"
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {loading && !data ? (
            <PageLoader label="Loading attendance calendar…" hint="Fetching sessions and verification times" />
          ) : data ? (
            /* 2-Column Responsive Layout: Calendar on Left, Time & Logs on the Right Side */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.42fr) minmax(320px, 1fr)',
                gap: '20px',
                alignItems: 'start',
              }}
            >
              {/* ══ LEFT COLUMN: CALENDAR GRID ══════════════════════════════ */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Month Navigation Bar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    background: 'var(--bg-secondary)',
                    padding: '8px 14px',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={handlePrevMonth}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 10px' }}
                  >
                    Previous
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={17} style={{ color: 'var(--primary)' }} />
                    <h4 style={{ fontSize: '14.5px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      {data.month_label}
                    </h4>
                  </div>

                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={handleNextMonth}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 10px' }}
                  >
                    Next 
                  </button>
                </div>

                {/* Calendar Grid Container */}
                <div
                  style={{
                    width: '100%',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-xs)',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(7, 1fr)',
                      background: 'var(--bg-card)',
                    }}
                  >
                    {/* Day Headers */}
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                      <div
                        key={d}
                        style={{
                          padding: '8px 4px',
                          textAlign: 'center',
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          color: i === 0 || i === 6 ? 'var(--text-muted)' : 'var(--text-secondary)',
                          background: 'var(--bg-secondary)',
                          borderBottom: '1px solid var(--border)',
                          borderRight: i < 6 ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        {d}
                      </div>
                    ))}

                    {/* Calendar Day Cells */}
                    {data.calendar_weeks.map((week, wIdx) =>
                      week.map((day, dIdx) => {
                        const isSelected = selectedDay && selectedDay.date === day.date;
                        const hasRecords = day.records && day.records.length > 0;
                        const isOther = !day.is_current_month;

                        return (
                          <div
                            key={`${wIdx}-${dIdx}`}
                            onClick={() => setSelectedDay(day)}
                            style={{
                              minHeight: '76px',
                              padding: '6px',
                              borderBottom: '1px solid var(--border)',
                              borderRight: dIdx < 6 ? '1px solid var(--border)' : 'none',
                              background: isSelected
                                ? 'rgba(99, 102, 241, 0.08)'
                                : day.is_today
                                ? '#eff6ff'
                                : isOther
                                ? '#fafafa'
                                : 'var(--bg-card)',
                              opacity: isOther ? 0.45 : 1,
                              cursor: hasRecords ? 'pointer' : 'default',
                              display: 'flex',
                              flexDirection: 'column',
                              transition: 'all 0.15s ease',
                              position: 'relative',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '4px',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: day.is_today ? 800 : 600,
                                  color: day.is_today ? 'var(--info)' : isOther ? 'var(--text-muted)' : 'var(--text-primary)',
                                }}
                              >
                                {day.day_num}
                              </span>
                              {day.is_today && (
                                <span
                                  style={{
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    padding: '1px 4px',
                                    borderRadius: '3px',
                                    background: 'var(--info)',
                                    color: '#fff',
                                    letterSpacing: '0.4px',
                                  }}
                                >
                                  TODAY
                                </span>
                              )}
                            </div>

                            {/* Attendance Badges with Status & Time */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: 'auto' }}>
                              {day.records.map((rec, rIdx) => {
                                const isPresent = rec.status === 'present';
                                const isLate = rec.status === 'late';
                                const isAbsent = rec.status === 'absent';

                                const bg = isPresent ? '#dcfce7' : isLate ? '#fef3c7' : '#fee2e2';
                                const text = isPresent ? '#15803d' : isLate ? '#b45309' : '#b91c1c';
                                const bdr = isPresent ? '#86efac' : isLate ? '#fde68a' : '#fca5a5';

                                return (
                                  <div
                                    key={rIdx}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '2px 5px',
                                      borderRadius: '4px',
                                      fontSize: '10px',
                                      fontWeight: 700,
                                      background: bg,
                                      color: text,
                                      border: `1px solid ${bdr}`,
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    <span>{rec.status_display || 'Present'}</span>
                                    {(rec.raw_time || rec.time) && (rec.raw_time || rec.time) !== 'Class time' && (
                                      <span style={{ fontSize: '9px', fontWeight: 700, opacity: 0.9, marginLeft: 'auto', fontFamily: 'monospace' }}>
                                        {rec.raw_time || rec.time}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Calendar Legend */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '14px',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 12px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius)',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    marginTop: '10px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }} />
                    <span>Present (On Time)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--warning)' }} />
                    <span>Late</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--danger)' }} />
                    <span>Absent</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#cbd5e1' }} />
                    <span>Off-Cycle / No Class</span>
                  </div>
                </div>
              </div>

              {/* ══ RIGHT COLUMN: "TIME ON THE SIDE" & ATTENDANCE LOGS ════════ */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
              >
                {/* 4 Attendance Health Metric Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '10px',
                  }}
                >
                  <div className="stat-card green" style={{ padding: '12px 14px', borderRadius: 'var(--radius)' }}>
                    <div className="stat-info">
                      <div className="value" style={{ fontSize: '20px', fontWeight: 800, color: 'var(--success)' }}>
                        {data.stats.rate}%
                      </div>
                      <div className="label" style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Attendance Rate
                      </div>
                    </div>
                  </div>

                  <div className="stat-card blue" style={{ padding: '12px 14px', borderRadius: 'var(--radius)' }}>
                    <div className="stat-info">
                      <div className="value" style={{ fontSize: '20px', fontWeight: 800, color: 'var(--info)' }}>
                        {data.stats.present}
                      </div>
                      <div className="label" style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Present Days
                      </div>
                    </div>
                  </div>

                  <div className="stat-card orange" style={{ padding: '12px 14px', borderRadius: 'var(--radius)' }}>
                    <div className="stat-info">
                      <div className="value" style={{ fontSize: '20px', fontWeight: 800, color: 'var(--warning)' }}>
                        {data.stats.late}
                      </div>
                      <div className="label" style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Late Days
                      </div>
                    </div>
                  </div>

                  <div
                    className="stat-card"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius)',
                      background: 'var(--danger-light)',
                      borderLeft: '4px solid var(--danger)',
                    }}
                  >
                    <div className="stat-info">
                      <div className="value" style={{ fontSize: '20px', fontWeight: 800, color: 'var(--danger)' }}>
                        {data.stats.absent}
                      </div>
                      <div className="label" style={{ fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Absent Days
                      </div>
                    </div>
                  </div>
                </div>

                {/* Side Logs Panel: "TIME ON THE SIDE" */}
                <div
                  className="card"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      padding: '12px 16px',
                      background: 'var(--bg-secondary)',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <Clock size={15} style={{ color: 'var(--primary)' }} />
                      Time on the Side (Scan Logs)
                    </span>
                    <span className="badge badge-accent" style={{ fontSize: '11px', fontWeight: 700 }}>
                      {sessionLogs.length} Records
                    </span>
                  </div>

                  {/* Scrollable list of verification logs */}
                  <div
                    style={{
                      padding: '10px 12px',
                      maxHeight: '340px',
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {sessionLogs.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        No verified attendance logs recorded for this section yet.
                      </div>
                    ) : (
                      sessionLogs.map((log) => {
                        const isPresent = log.status === 'present';
                        const isLate = log.status === 'late';
                        const isAbsent = log.status === 'absent';

                        return (
                          <div
                            key={log.id}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 'var(--radius)',
                              background: isPresent
                                ? 'rgba(16, 185, 129, 0.05)'
                                : isLate
                                ? 'rgba(245, 158, 11, 0.05)'
                                : 'rgba(239, 68, 68, 0.05)',
                              border: `1px solid ${
                                isPresent
                                  ? 'rgba(16, 185, 129, 0.25)'
                                  : isLate
                                  ? 'rgba(245, 158, 11, 0.25)'
                                  : 'rgba(239, 68, 68, 0.25)'
                              }`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '10px',
                            }}
                          >
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {log.date}{' '}
                                <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)' }}>
                                  ({log.day})
                                </span>
                              </div>
                              <div style={{ marginTop: '3px' }}>
                                {isPresent ? (
                                  <span
                                    className="badge badge-success"
                                    style={{
                                      fontSize: '10px',
                                      padding: '2px 6px',
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    <CheckCircle size={10} /> Present
                                  </span>
                                ) : isLate ? (
                                  <span
                                    className="badge badge-warning"
                                    style={{
                                      fontSize: '10px',
                                      padding: '2px 6px',
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    <Clock size={10} /> Late
                                  </span>
                                ) : (
                                  <span
                                    className="badge badge-danger"
                                    style={{
                                      fontSize: '10px',
                                      padding: '2px 6px',
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    <XCircle size={10} /> Absent
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Recognized Timestamp on the Side */}
                            <div style={{ textAlign: 'right' }}>
                              <div
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  color: isPresent ? 'var(--success)' : isLate ? 'var(--warning)' : 'var(--text-muted)',
                                  fontFamily: 'monospace',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: 'var(--bg-card)',
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                }}
                              >
                                <Clock size={12} />
                                <span>{log.time}</span>
                              </div>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                Scan Timestamp
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              Could not load attendance calendar.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className="modal-footer"
          style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'var(--bg-secondary)',
          }}
        >
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
