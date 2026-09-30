import React from 'react';

/**
 * SectionTableHeader - Table header for sections table
 */
export default function SectionTableHeader({ role }) {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '65px', textAlign: 'center' }}>
          Program
        </th>
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '65px', textAlign: 'center' }}>
          Course
        </th>
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', borderRight: '1px solid var(--border)', width: '110px' }}>
          Section &amp; Year
        </th>
        {role !== 'instructor' && (
          <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '115px' }}>
            Instructor
          </th>
        )}
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '295px' }}>
          Subject
        </th>
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '210px' }}>
          Schedule
        </th>
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '110px', textAlign: 'center' }}>
          School Year
        </th>
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '90px', textAlign: 'center' }}>
          Students
        </th>
        {role === 'instructor' && (
          <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', width: '100px', textAlign: 'center' }}>
            Attendance
          </th>
        )}
        <th style={{ padding: '10px 8px', fontSize: '11px', fontWeight: '650', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px', textAlign: 'center', width: '75px' }}>
          Actions
        </th>
      </tr>
    </thead>
  );
}
