/**
 * Error Message Formatter
 * Converts technical backend errors into user-friendly messages
 */

/**
 * Format error messages from API responses into user-friendly text
 * @param {Error|Object|String} error - Error object, response data, or string
 * @returns {String} User-friendly error message
 */
export function formatErrorMessage(error) {
  // If it's already a string, process it
  if (typeof error === 'string') {
    return formatSingleError(error);
  }

  // If it's an Error object with a message
  if (error?.message) {
    return formatSingleError(error.message);
  }

  // If it's a response object with error field
  if (error?.error) {
    if (typeof error.error === 'string') {
      return formatSingleError(error.error);
    }
    if (typeof error.error === 'object') {
      return formatValidationErrors(error.error);
    }
  }

  // If it's a validation errors object (field: [errors])
  if (error && typeof error === 'object' && !error.message) {
    return formatValidationErrors(error);
  }

  // Default fallback
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Format a single error message
 * @param {String} message - Raw error message
 * @returns {String} Formatted error message
 */
function formatSingleError(message) {
  const errorMap = {
    // Authentication & Authorization
    'Invalid credentials': 'The username or password you entered is incorrect. Please try again.',
    'Authentication credentials were not provided': 'You must be logged in to access this page.',
    'Token has expired': 'Your session has expired. Please log in again.',
    'Invalid token': 'Your session is invalid. Please log in again.',
    'User not found': 'The user account could not be found.',
    'Admin permissions required': 'You do not have permission to perform this action. Administrator access is required.',
    'You do not have permission': 'You do not have permission to perform this action.',
    
    // User Management
    'Username already exists': 'This username is already taken. Please choose a different username.',
    'Email already exists': 'This email address is already registered. Please use a different email.',
    'Student ID already exists': 'This Student ID is already registered in the system.',
    'Employee ID already exists': 'This Faculty ID is already registered in the system.',
    'Cannot delete your own account': 'You cannot delete your own account while logged in.',
    'Cannot deactivate your own account': 'You cannot deactivate your own administrator account.',
    
    // Validation Errors
    'This field is required': 'This field is required. Please provide a value.',
    'This field may not be blank': 'This field cannot be left blank.',
    'This field may not be null': 'This field is required. Please provide a value.',
    'Enter a valid email address': 'Please enter a valid email address (e.g., user@example.com).',
    'Ensure this field has at most': 'The value you entered is too long. Please shorten it.',
    'Ensure this field has at least': 'The value you entered is too short. Please provide more characters.',
    
    // Date & Time Errors
    'Date has wrong format': 'Please enter a valid date in the format: Month/Day/Year (e.g., 03/23/2003).',
    'Time has wrong format': 'Please enter a valid time in the format: Hour:Minute AM/PM (e.g., 2:30 PM).',
    'Datetime has wrong format': 'Please enter a valid date and time.',
    
    // Database Errors  
    'Cannot assign': 'The selected option is not valid. Please choose a valid option from the list.',
    'course_ref": ["Invalid pk': 'The selected course is not valid. Please select a course from the list.',
    'Student.course_ref" must be a "Course" instance': 'Please select a valid course from the dropdown list.',
    'Cannot assign "2": "Student.course_ref" must be a "Course" instance': 'Please select a valid course from the dropdown menu. The value you entered is not recognized.',
    
    // Face Recognition
    'No face detected': 'No face was detected in the image. Please ensure your face is clearly visible and try again.',
    'Multiple faces detected': 'Multiple faces were detected. Please ensure only one person is in frame.',
    'Face recognition engine unavailable': 'The face recognition system is temporarily unavailable. Please try again later or contact support.',
    'Face enrollment failed': 'Face enrollment failed. Please ensure your face is well-lit and centered, then try again.',
    
    // Network & Server Errors
    'Network Error': 'Unable to connect to the server. Please check your internet connection and try again.',
    'Failed to fetch': 'Unable to connect to the server. Please check your internet connection.',
    '500': 'A server error occurred. Please try again or contact support if the problem persists.',
    '503': 'The service is temporarily unavailable. Please try again in a few moments.',
    '404': 'The requested resource could not be found.',
    
    // Session & Attendance
    'Session not found': 'The attendance session could not be found or has been deleted.',
    'Session is closed': 'This attendance session has been closed and is no longer accepting entries.',
    'Already marked present': 'You have already been marked present for this session.',
    'Student not enrolled': 'You are not enrolled in this section. Please contact your instructor.',
    
    // File Upload
    'File too large': 'The file you selected is too large. Please choose a smaller file.',
    'Invalid file type': 'The file type is not supported. Please upload a valid file.',
    'Upload failed': 'File upload failed. Please try again.',
  };

  // Check for exact matches
  for (const [key, value] of Object.entries(errorMap)) {
    if (message.includes(key)) {
      return value;
    }
  }

  // Handle specific patterns
  if (message.includes('must be a') && message.includes('instance')) {
    const fieldMatch = message.match(/"([^"]+)"/);
    const field = fieldMatch ? fieldMatch[1] : 'field';
    return `Please select a valid option for ${field}. The value entered is not recognized.`;
  }

  if (message.includes('Invalid pk')) {
    return 'The selected option is not valid. Please choose from the available options in the dropdown.';
  }

  if (message.includes('does not exist')) {
    return 'The selected item no longer exists. Please refresh the page and try again.';
  }

  if (message.includes('required') || message.includes('blank') || message.includes('null')) {
    return 'This field is required. Please provide a value before saving.';
  }

  if (message.includes('duplicate') || message.includes('already exists')) {
    return 'This value already exists in the system. Please use a different value.';
  }

  if (message.includes('password')) {
    if (message.includes('too short')) {
      return 'Password must be at least 8 characters long.';
    }
    if (message.includes('too common')) {
      return 'This password is too common. Please choose a more secure password.';
    }
    if (message.includes('entirely numeric')) {
      return 'Password cannot be entirely numbers. Please include letters and special characters.';
    }
    return 'Password does not meet security requirements. Please choose a stronger password.';
  }

  // Return the original message if no mapping found, but clean it up
  return cleanupTechnicalMessage(message);
}

/**
 * Format validation errors object into readable message
 * @param {Object} errors - Validation errors object
 * @returns {String} Formatted error message
 */
function formatValidationErrors(errors) {
  if (!errors || typeof errors !== 'object') {
    return 'Please correct the errors in the form and try again.';
  }

  const errorMessages = [];

  for (const [field, messages] of Object.entries(errors)) {
    const fieldName = formatFieldName(field);
    const fieldErrors = Array.isArray(messages) ? messages : [messages];
    
    fieldErrors.forEach(msg => {
      const formattedMsg = formatSingleError(msg);
      errorMessages.push(`${fieldName}: ${formattedMsg}`);
    });
  }

  if (errorMessages.length === 0) {
    return 'Please correct the errors in the form and try again.';
  }

  if (errorMessages.length === 1) {
    return errorMessages[0];
  }

  return errorMessages.join('\n');
}

/**
 * Convert field name from snake_case to Title Case
 * @param {String} field - Field name in snake_case
 * @returns {String} Formatted field name
 */
function formatFieldName(field) {
  const fieldNameMap = {
    'course_ref': 'Course',
    'program_id': 'Academic Program',
    'year_level': 'Year Level',
    'student_id': 'Student ID',
    'faculty_id': 'Faculty ID',
    'first_name': 'First Name',
    'last_name': 'Last Name',
    'middle_name': 'Middle Name',
    'birth_date': 'Date of Birth',
    'birth_place': 'Place of Birth',
    'civil_status': 'Civil Status',
    'current_address': 'Current Address',
    'mobile_number': 'Mobile Number',
    'date_hired': 'Date Hired',
    'employment_status': 'Employment Status',
    'office_location': 'Office Location',
    'consultation_hours': 'Consultation Hours',
    'education_background': 'Education Background',
  };

  if (fieldNameMap[field]) {
    return fieldNameMap[field];
  }

  // Convert snake_case to Title Case
  return field
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Clean up technical error messages
 * @param {String} message - Technical error message
 * @returns {String} Cleaned up message
 */
function cleanupTechnicalMessage(message) {
  // Remove technical jargon
  let cleaned = message
    .replace(/\[ErrorDetail\(string='([^']+)', code='[^']+'\)\]/g, '$1')
    .replace(/ErrorDetail\(string='([^']+)', code='[^']+'\)/g, '$1')
    .replace(/\[Object object\]/gi, '')
    .replace(/null/gi, 'empty')
    .replace(/undefined/gi, 'empty');

  // Capitalize first letter
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  // Ensure it ends with a period
  if (!cleaned.endsWith('.') && !cleaned.endsWith('!') && !cleaned.endsWith('?')) {
    cleaned += '.';
  }

  return cleaned;
}

/**
 * Get user-friendly error for specific scenarios
 */
export const ErrorMessages = {
  NETWORK_ERROR: 'Unable to connect to the server. Please check your internet connection and try again.',
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again or contact support if the problem persists.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again to continue.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  VALIDATION_ERROR: 'Please correct the errors in the form before submitting.',
  SERVER_ERROR: 'A server error occurred. Please try again later.',
  NOT_FOUND: 'The requested item could not be found.',
  SAVE_SUCCESS: 'Changes saved successfully.',
  DELETE_SUCCESS: 'Item deleted successfully.',
  CREATE_SUCCESS: 'Item created successfully.',
  UPDATE_SUCCESS: 'Item updated successfully.',
};
