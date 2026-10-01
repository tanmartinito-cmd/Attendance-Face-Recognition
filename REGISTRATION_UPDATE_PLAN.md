# Registration Form Update Plan

## Goal
Make the public registration form include all the same fields as the admin registration form, so approved students have complete profiles without additional data entry.

## Fields to Add to Public Registration

### Already Have:
- Student ID / Faculty ID ✓
- First/Middle/Last Name ✓
- Email ✓
- Program, Course, Year Level (students) ✓
- Department (faculty) ✓
- Password ✓

### Need to Add:

#### Personal Information
- **Gender** (dropdown: Male, Female)
- **Birth Date** (date input)
- **Birth Place** (text input)
- **Civil Status** (dropdown: Single, Married, Widowed, Separated)
- **Religion** (dropdown: Roman Catholic, SDA, INC, Baptist, Islam, Born Again, Other)
- **Citizenship** (text input, default: "Filipino")
- **Languages Spoken** (checkboxes: English, Filipino, Cebuano + Other text input)

#### Address Information
- **House#/Street & Barangay** (textarea)
- **Region** (dropdown from PSGC API)
- **Province** (dropdown from PSGC API, depends on Region)
- **City/Municipality** (dropdown from PSGC API, depends on Province)

#### Contact Information
- **Mobile Number** (PhoneInput component with validation)
- **Telephone/Landline** (optional text input)

## Layout Strategy

Use a 2-column grid layout with cards (like admin form):

**Left Column:**
1. Card: Academic Program & Degree
   - Program, Course, Year Level (students) OR Department (faculty)

2. Card: Personal Information
   - Family Name, Given Name, Middle Name
   - Birth Date, Birth Place
   - Gender, Civil Status
   - Religion, Citizenship
   - Languages Spoken (checkboxes)

**Right Column:**
3. Card: Address Information
   - Street/Barangay (textarea)
   - Region, Province, City/Municipality dropdowns

4. Card: Contact & Security
   - Mobile Number (required)
   - Telephone (optional)
   - Email
   - Password, Confirm Password

5. Face Consent Checkbox (students only)
6. Turnstile Widget
7. Submit Button

## Backend Changes Needed

Update the `RegistrationService.register()` method to accept and save all these additional fields when creating the user and profile.

## Implementation Steps

1. ✓ Add imports (PhoneInput, psgcApi utilities)
2. ✓ Update EMPTY state with all new fields
3. Add address handling (region/province/city dropdowns)
4. Update form JSX with all fields in 2-column grid
5. Update submit handler to include all fields in payload
6. Update backend registration service to save all fields
7. Test with both student and faculty registration

## Notes
- Keep the same dropdown options as admin form
- Use the same PSGC API for address data
- Maintain the grid layout to minimize scrolling
- Card width: 900px max (responsive)
