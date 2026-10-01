import React from 'react';
import { Edit2, UserX, UserCheck, Trash2 } from 'lucide-react';
import { confirmAction } from '../../ui';
import ActionPopover from '../shared/ActionPopover';
import Avatar from '../shared/Avatar';
import { resolveMediaUrl } from '../../api';

/**
 * UserTableRow - Single user row in the users table
 */
export default function UserTableRow({ 
  user, 
  currentUser, 
  onEdit, 
  onToggleStatus, 
  onDelete 
}) {
  const isSelf = user.id === currentUser?.id || user.username === currentUser?.username;
  const displayName = user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.username;

  const requestDeactivate = () => confirmAction({
    title: 'Deactivate this account?',
    message: `${displayName} (@${user.username}) will no longer be able to sign in. You can reactivate the account at any time.`,
    confirmLabel: 'Deactivate account',
    tone: 'danger',
    onConfirm: () => onToggleStatus(user, false),
  });
  
  // Get face image from student profile or profile_image
  const faceImageUrl = resolveMediaUrl(
    user.student_profile?.face_image || user.profile_image
  );
  return (
    <tr key={user.id || user.username}>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Avatar src={faceImageUrl} name={displayName} size={34} ring className="user-avatar" />
          <div>
            <div style={{ fontWeight: '600' }}>
              {user.first_name ? `${user.first_name} ${user.last_name || ''}` : user.username}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{user.username}</div>
          </div>
        </div>
      </td>
      <td>
        <span 
          className={`badge ${
            user.role === 'admin' ? 'badge-danger' : 
            user.role === 'instructor' ? 'badge-info' : 
            'badge-neutral'
          }`} 
          style={{ textTransform: 'capitalize' }}
        >
          {user.role}
        </span>
      </td>
      <td>{user.email || '—'}</td>
      <td>{user.phone || '—'}</td>
      <td style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
        {user.instructor_profile ? (
          <span className="badge badge-outline" style={{ fontWeight: '600' }}>
            {user.instructor_profile.department || 'Faculty'}
          </span>
        ) : user.student_profile ? (
          <span className="badge badge-accent" style={{ fontWeight: '600' }}>
            {user.student_profile.display_academic_program || 
             (user.student_profile.program_code ? 
              `${user.student_profile.program_code} • ${user.student_profile.course}` : 
              (user.student_profile.course || 'BSIT')
             )}
          </span>
        ) : (
          <span className="text-muted">Standard Access</span>
        )}
      </td>
      <td>
        <button
          type="button"
          onClick={() => (user.is_active ? requestDeactivate() : onToggleStatus(user, true))}
          className={`badge status-toggle ${user.is_active ? 'badge-success' : 'badge-danger'}`}
          disabled={user.is_active && isSelf}
          title={user.is_active ? (isSelf ? 'You cannot deactivate your own account' : 'Active. Click to deactivate.') : 'Inactive. Click to activate.'}
        >
          {user.is_active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <ActionPopover
          items={(() => {
            const items = [
              {
                label: 'Edit User',
                icon: Edit2,
                onClick: () => onEdit(user),
              },
            ];
            if (user.is_active) {
              if (!isSelf) {
                items.push({
                  label: 'Deactivate Account',
                  icon: UserX,
                  isDanger: true,
                  onClick: requestDeactivate,
                });
              }
            } else {
              items.push({
                label: 'Activate Account',
                icon: UserCheck,
                isSuccess: true,
                onClick: () => onToggleStatus(user, true),
              });
            }
            if (!isSelf) {
              items.push({ isDivider: true });
              items.push({
                label: 'Delete User',
                icon: Trash2,
                isDanger: true,
                onClick: () => onDelete(user),
              });
            }
            return items;
          })()}
        />
      </td>
    </tr>
  );
}
