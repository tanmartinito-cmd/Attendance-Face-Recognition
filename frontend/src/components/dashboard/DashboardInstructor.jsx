import React from 'react';
import { Activity, BellRing, Calendar, CalendarCheck, ClipboardList, Clock, Coffee, Layers, Radio, ScanFace, Sun, Users } from 'lucide-react';
import { formatSchoolScheduleParts } from '../../utils/time';
import { getScheduleStatus, getUpcomingSchedules, scheduleMeetingDays, scheduleTimeMinutes } from '../../utils/scheduleStatus';

export default function DashboardInstructor({ stats, sections, schedules, sessions, onNavigate }) {
  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const liveCount = sessions.filter((session) => session.status === 'open').length;
  const finalizedCount = sessions.filter((session) => session.status === 'closed').length;
  const totalStudents = sections.reduce((sum, section) => sum + (section.student_count || 0), 0) || stats.totalStudents || 0;
  const upcoming = getUpcomingSchedules(schedules, sessions);
  // Only sections that actually meet today, each limited to today's meeting(s).
  const todaysClasses = getTodaysClasses(sections, schedules);

  return <div className="page-content teacher-portal">
    <div className="teacher-metric-grid mb-3">
      <Metric icon={Layers} tone="blue" value={sections.length} label="Assigned sections" detail={`${schedules.length} weekly schedule slots`} />
      <Metric icon={Users} tone="violet" value={totalStudents} label="Enrolled students" detail="Across your assigned classes" />
      <Metric icon={CalendarCheck} tone="amber" value={finalizedCount} label="Finalized today" detail={`${liveCount} attendance session${liveCount === 1 ? '' : 's'} live`} />
      <Metric icon={Radio} tone={liveCount ? 'green' : 'slate'} value={liveCount} label="Live sessions" detail={liveCount ? 'Camera scanning in progress' : 'Ready for your next class'} />
    </div>

    <section className="teacher-reminder-card mb-3" aria-label="Upcoming class reminders">
      <div className="teacher-reminder-heading"><span className="teacher-reminder-icon"><BellRing size={18} /></span><div><h2>Today’s teaching schedule</h2><p>{upcoming.length ? 'Your next class reminders and attendance availability.' : 'No remaining classes are scheduled for today.'}</p></div></div>
      <div className="teacher-reminder-list">{upcoming.length ? upcoming.map(({ schedule, status }) => <UpcomingClass key={schedule.id} schedule={schedule} status={status} />) : <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('sections')}>View weekly timetable </button>}</div>
    </section>

    <div className="teacher-dashboard-grid mb-3">
      <section className="card teacher-classes-card">
        <div className="teacher-card-heading"><div><span className="eyebrow"><Sun size={14} /> {todayStr}</span><h2>Today’s classes</h2></div><span className="badge badge-muted">{finalizedCount} finalized · {liveCount} live</span></div>
        {todaysClasses.length === 0 ? <EmptyClasses onNavigate={onNavigate} hasSections={sections.length > 0} /> : <div className="teacher-class-list">{todaysClasses.map(({ section, schedules: todaySchedules }) => <InstructorClassRow key={section.id} section={section} todaySchedules={todaySchedules} sessions={sessions} />)}</div>}
      </section>
      <aside className="card teacher-insight-card"><div className="teacher-card-heading"><div><span className="eyebrow"><Activity size={14} /> Overview</span><h2>At a glance</h2></div></div><div className="teacher-insight-grid"><Insight label="Weekly classes" value={schedules.length} icon={<Calendar size={15} />} /><Insight label="Recorded sessions" value={sessions.length} icon={<ClipboardList size={15} />} /><Insight label="Live now" value={liveCount} icon={<Radio size={15} />} /><Insight label="Late arrivals" value="Auto" icon={<Clock size={15} />} /></div><div className="teacher-tip"><ScanFace size={17} /><span>Late arrivals are automatically marked after the configured grace period from the scheduled class start.</span></div><div className="teacher-insight-actions"><button type="button" className="btn btn-outline" onClick={() => onNavigate('sections')}>Schedule</button><button type="button" className="btn btn-primary" onClick={() => onNavigate('section_report')}>Reports</button></div></aside>
    </div>

    <section className="card teacher-recent-card"><div className="teacher-card-heading"><div><span className="eyebrow"><Clock size={14} /> Latest activity</span><h2>Recent attendance sessions</h2></div><button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('section_report')}>Open reports </button></div><div className="teacher-session-list">{sessions.length ? sessions.slice(0, 8).map((session) => <RecentSession key={session.id} session={session} />) : <p className="teacher-empty-inline">No attendance sessions recorded yet.</p>}</div></section>
  </div>;
}

function Metric({ icon: Icon, tone, value, label, detail }) { return <div className={`teacher-metric tone-${tone}`}><span><Icon size={20} /></span><div><strong>{value}</strong><p>{label}</p><small>{detail}</small></div></div>; }
function Insight({ label, value, icon }) { return <div className="teacher-insight"><span>{icon}</span><strong>{value}</strong><small>{label}</small></div>; }
function EmptyClasses({ onNavigate, hasSections }) { return <div className="teacher-empty"><Coffee size={30} /><strong>{hasSections ? 'No classes today' : 'No assigned classes'}</strong><span>{hasSections ? 'You have no class meetings scheduled for today.' : 'Your teaching assignments will appear here.'}</span><button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('sections')}>Open schedule</button></div>; }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Returns [{ section, schedules }] for sections meeting today, keeping only today's meetings, sorted by start time.
function getTodaysClasses(sections, schedules, now = new Date()) {
  const today = WEEKDAYS[now.getDay()];
  const meetsToday = (schedule) => scheduleMeetingDays(schedule).includes(today);
  const byStart = (a, b) => (scheduleTimeMinutes(a.start_time) ?? 1440) - (scheduleTimeMinutes(b.start_time) ?? 1440);
  return sections
    .map((section) => {
      const own = schedules.filter((schedule) => String(schedule.section) === String(section.id));
      const source = own.length ? own : section.schedules || [];
      return { section, schedules: source.filter(meetsToday).sort(byStart) };
    })
    .filter((entry) => entry.schedules.length > 0)
    .sort((a, b) => byStart(a.schedules[0], b.schedules[0]));
}

function UpcomingClass({ schedule, status }) { return <div className={`teacher-reminder-item status-${status.key}`}><div><span className="badge badge-accent">{schedule.subject_code || 'Class'}</span><strong>{schedule.subject_name || schedule.section_name || 'Scheduled class'}</strong><small>{formatSchoolScheduleParts(schedule).fullTime} · {schedule.room || 'Room TBA'}</small></div><div className="teacher-reminder-action"><ScheduleBadge status={status} /></div></div>; }

function InstructorClassRow({ section, todaySchedules, sessions }) {
  const displaySchedules = todaySchedules;
  const subject = section.effective_subject_code || section.subject_details?.code || displaySchedules[0]?.subject_code || section.subjects?.[0]?.code || '—';
  const name = section.effective_subject_name || section.subject_details?.name || displaySchedules[0]?.subject_name || section.subjects?.[0]?.name || 'Class subject';
  // If a section meets more than once today, show the most relevant meeting's status.
  const statuses = displaySchedules.map((schedule) => getScheduleStatus(schedule, sessions));
  const priority = ['live', 'ready', 'upcoming', 'finalized', 'ended'];
  const status = [...statuses].sort((a, b) => priority.indexOf(a.key) - priority.indexOf(b.key))[0];
  return <article className="teacher-class-row"><div className="teacher-class-main"><span className="code-tag">{subject}</span><div><strong>{section.name}</strong><p>{name}</p></div></div><div className="teacher-class-schedule">{displaySchedules.map((entry) => { const parts = formatSchoolScheduleParts(entry); return <span key={entry.id || parts.fullTime} className="schedule-text"><span className="schedule-text-time">{parts.fullTime}</span><span className="schedule-text-room">{parts.room || 'Room TBA'}</span></span>; })}</div><div className="teacher-class-status"><ScheduleBadge status={status} /></div></article>;
}
function ScheduleBadge({ status }) { const tone = status.key === 'live' ? 'success' : status.key === 'ready' ? 'info' : status.key === 'finalized' ? 'success-muted' : status.key === 'ended' ? 'muted' : 'warning'; return <div className={`class-status tone-${tone}`} title={status.detail}><b>{status.label}</b><small>{status.detail}</small></div>; }
function RecentSession({ session }) { const parts = formatSchoolScheduleParts(session.schedule_details || {}); return <article className="teacher-session-row"><div><strong>{session.section_name || session.schedule_details?.section_name || 'Section'}</strong><span>{session.subject_code || session.schedule_details?.subject_code || '—'} · {parts.fullTime || session.schedule_display || 'Schedule'}</span></div><span>{session.date}</span><span className={`badge badge-${session.status === 'open' ? 'success' : 'muted'}`}>{session.status === 'open' ? 'Live' : 'Finalized'}</span></article>; }