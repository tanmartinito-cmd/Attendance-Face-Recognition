# Frontend Refactoring - Next Steps Guide

## Current Progress
✅ **Task 1**: Shared component library (8 components created)  
✅ **Task 2**: DashboardView refactored (Admin dashboard extracted)  
🔄 **Task 3**: UsersView refactoring (in progress)

---

## Task 3: UsersView Refactoring - IMPLEMENTATION GUIDE

### Current File Structure
- **UsersView.jsx**: 987 lines
- **Breakdown**:
  - Lines 1-250: Imports, state, data loading, handlers
  - Lines 250-360: User table rendering setup
  - Lines 360-550: User table with rows
  - Lines 558-762: Add User Modal (204 lines)
  - Lines 764-987: Edit User Modal (223 lines)

### Components to Extract

#### 1. UserTable.jsx (Priority: HIGH)
**Location**: Extract from lines 360-550  
**Size**: ~200 lines  
**Purpose**: Main table with filter tabs, search bar, and user rows

```jsx
// frontend/src/components/users/UserTable.jsx
import React from 'react';
import { FilterTabs, SearchBar, EmptyState } from '../shared';
import UserTableRow from './UserTableRow';

export default function UserTable({ 
  users, 
  search, 
  roleFilter,
  onSearchChange,
  onRoleFilterChange,
  currentUser,
  onEditUser,
  onToggleStatus,
  onDeleteUser
}) {
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
    <>
      {/* Filter & Search */}
      <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <FilterTabs
            tabs={[
              { value: 'all', label: 'All Roles' },
              { value: 'admin', label: 'Admins' },
              { value: 'teacher', label: 'Teachers' },
              { value: 'student', label: 'Students' }
            ]}
            activeTab={roleFilter}
            onTabChange={onRoleFilterChange}
          />
          <SearchBar
            value={search}
            onChange={onSearchChange}
            placeholder="Search user by name, email..."
            width="280px"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrapper">
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
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <EmptyState
                      icon={<Users size={40} />}
                      title="No users match your filter"
                      message="Try adjusting your search or filter criteria."
                    />
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <UserTableRow
                    key={user.id}
                    user={user}
                    currentUser={currentUser}
                    onEdit={onEditUser}
                    onToggleStatus={onToggleStatus}
                    onDelete={onDeleteUser}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
```

#### 2. AddUserModal.jsx (Priority: MEDIUM)
**Location**: Extract from lines 558-762  
**Size**: 204 lines  
**Purpose**: Modal form for adding staff/teacher users

**Key Features**:
- Role selection (teacher/admin)
- User info fields (username, name, email, phone)
- Password with strength meter
- Faculty profile fields (employee_id, department, specialization)
- Dynamic department dropdown from programs API
- Form validation (phone, password strength, required fields)

**Extract Process**:
1. Copy lines 558-762 to new file
2. Accept props: `isOpen`, `onClose`, `onSubmit`, `programs`
3. Move form state and handlers to parent or keep internal
4. Import shared components: `PasswordInput`, `PhoneInput`, `Toast`

#### 3. EditUserModal.jsx (Priority: MEDIUM)
**Location**: Extract from lines 764-987  
**Size**: 223 lines  
**Purpose**: Modal form for editing existing users

**Key Features**:
- Edit all user fields
- Role-specific sections (teacher profile, student profile)
- Optional password change
- Active/inactive toggle
- Form validation

**Extract Process**:
1. Copy lines 764-987 to new file
2. Accept props: `isOpen`, `user`, `onClose`, `onUpdate`, `programs`
3. Initialize form with user data
4. Handle conditional rendering for teacher/student profiles

### Refactored UsersView.jsx Structure

```jsx
// frontend/src/views/UsersView.jsx (AFTER REFACTORING)
// Target: ~150-200 lines (down from 987)

import React, { useState, useEffect } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { Api } from '../api';
import { Toast } from '../components/shared';
import UserTable from '../components/users/UserTable';
import AddUserModal from '../components/users/AddUserModal';
import EditUserModal from '../components/users/EditUserModal';

export default function UsersView({ user, onNavigate, onSetHeaderInfo }) {
  const [users, setUsers] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Load data
  useEffect(() => {
    loadUsers();
    loadPrograms();
  }, []);

  // Set header
  useEffect(() => {
    if (onSetHeaderInfo) {
      onSetHeaderInfo({
        title: 'Users',
        subtitle: 'System users, faculty, staff and students',
        headerActions: (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={() => onNavigate('student_enrollment')}>
              <UserPlus size={16} /> Enroll Student (FSUU)
            </button>
            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={16} /> Add Staff/Teacher
            </button>
          </div>
        ),
      });
    }
  }, [onSetHeaderInfo]);

  async function loadUsers() { /* ... */ }
  async function loadPrograms() { /* ... */ }
  
  // Handlers
  const handleCreateUser = async (formData) => { /* ... */ };
  const handleUpdateUser = async (userId, formData) => { /* ... */ };
  const handleDeleteUser = async (u) => { /* ... */ };
  const handleToggleStatus = async (u, nextActive) => { /* ... */ };

  return (
    <div className="page-content">
      <Toast message={successMsg} type="success" onClose={() => setSuccessMsg('')} />
      <Toast message={errorMsg} type="error" onClose={() => setErrorMsg('')} />

      <UserTable
        users={users}
        search={search}
        roleFilter={roleFilter}
        onSearchChange={(e) => setSearch(e.target.value)}
        onRoleFilterChange={setRoleFilter}
        currentUser={user}
        onEditUser={setEditingUser}
        onToggleStatus={handleToggleStatus}
        onDeleteUser={handleDeleteUser}
      />

      {showAddModal && (
        <AddUserModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleCreateUser}
          programs={programs}
        />
      )}

      {editingUser && (
        <EditUserModal
          isOpen={!!editingUser}
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onUpdate={handleUpdateUser}
          programs={programs}
        />
      )}
    </div>
  );
}
```

---

## Task 4: SectionsView Refactoring - PLAN

### Current Structure
- **SectionsView.jsx**: 1,514 lines (LARGEST FILE)
- **Complexity**: Very high (multiple views, modals, timetable grid)

### Components to Extract (8 components)

1. **SectionTable.jsx** (~300 lines)
   - Main table view with complex multi-subject rows
   - Schedule display logic
   - Session status indicators

2. **SectionRow.jsx** (~100 lines)
   - Single section table row
   - Multi-subject support with rowSpan
   - Schedule badges, action buttons

3. **AddSectionModal.jsx** (~150 lines)
   - Form for creating new sections
   - Program/course/year selection
   - School year and semester

4. **EditSectionModal.jsx** (~150 lines)
   - Edit existing section details
   - Similar to Add modal

5. **SectionDetailModal.jsx** (~400 lines)
   - Large modal showing section roster
   - Enrollment management
   - Student list with attendance status

6. **EnrollmentForm.jsx** (~100 lines)
   - Form within detail modal
   - Regular vs irregular student enrollment
   - Subject selection for irregular students

7. **RosterTable.jsx** (~200 lines)
   - Student roster display
   - Filter by subject
   - Unenroll actions

8. **TimetableGrid.jsx** (~300 lines)
   - Weekly calendar grid view
   - Day/time slot visualization
   - Alternative view mode to table

### Refactored Size Target
- **SectionsView.jsx**: ~250 lines (down from 1,514)
- **Reduction**: 83% smaller main file

---

## Task 5: FaceEnrollmentView - PLAN

### Current Structure
- **FaceEnrollmentView.jsx**: 996 lines

### Components to Extract (4 components)

1. **StudentTable.jsx** (~200 lines)
   - Students list with face enrollment status
   - Search and filter
   - Enroll/Re-enroll buttons

2. **FaceEnrollModal.jsx** (~350 lines)
   - Camera feed component
   - Face capture with oval guide
   - Enrollment submission
   - Success/error states

3. **RegisterStudentModal.jsx** (~250 lines)
   - New student registration form
   - Basic student info
   - Course and year selection

4. **CameraFeed.jsx** (~150 lines - REUSABLE)
   - Generic camera component
   - Can be used by other features
   - Capture functionality
   - On/off state management

---

## Task 6: LiveScannerView - PLAN

### Current Structure
- **LiveScannerView.jsx**: 1,467 lines
- **Complexity**: VERY HIGH (real-time face detection, canvas overlays)

### Components to Extract (4 components)

1. **CameraView.jsx** (~400 lines)
   - Video feed with canvas overlay
   - Face detection box rendering
   - Real-time frame processing
   - Smooth lerp animations

2. **FaceOverlay.jsx** (~200 lines)
   - Canvas overlay logic
   - Corner brackets
   - Status indicators (scanning/verified/error)
   - Floating labels

3. **AttendanceList.jsx** (~300 lines)
   - Real-time attendance records
   - Student status updates
   - Search and filter
   - Manual mark buttons

4. **StatusIndicator.jsx** (~100 lines)
   - Camera status display
   - Recognition state
   - Session info
   - Control buttons (pause/stop)

### Special Considerations
- Real-time logic is complex
- Canvas rendering must stay performant
- useRef hooks for animation loops
- Extract carefully to avoid breaking real-time updates

---

## Priority Order

1. ✅ **Shared Components** - DONE
2. ✅ **DashboardView** - DONE (Admin extracted)
3. 🔄 **UsersView** - IN PROGRESS (TableRow created, modals pending)
4. ⏳ **SectionsView** - NEXT (highest value, most complex)
5. ⏳ **FaceEnrollmentView** - Camera component is reusable
6. ⏳ **LiveScannerView** - Handle last due to complexity

---

## Implementation Tips

### 1. Extract in Order
- Start with simplest components (table rows, cards)
- Then modals and forms
- Finally complex interactive components (camera, canvas)

### 2. Test After Each Extraction
- Verify component renders correctly
- Check props are passed properly
- Test all user interactions still work

### 3. Use Existing Shared Components
- Reuse `FilterTabs`, `SearchBar`, `EmptyState`
- Import `PasswordInput`, `PhoneInput` as needed
- Use `ActionPopover` for dropdown menus

### 4. Keep Props Simple
- Pass only what's needed
- Use callback props for actions
- Avoid passing entire objects when not needed

### 5. Maintain Styling
- Keep inline styles as-is initially
- Can extract to CSS later if needed
- Don't change visual appearance during refactoring

---

*Last Updated: Current Session*
*Components Created So Far: 16*
*Lines Reduced So Far: ~400 lines (Admin dashboard)*
