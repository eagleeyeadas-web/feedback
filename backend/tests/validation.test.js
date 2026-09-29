import { describe, test, expect } from '@jest/globals';
import { feedbackSchema } from '../src/middleware/validate.js';

describe('Feedback Validation Schema', () => {
  const validData = {
    customerName: 'Rajesh Kumar',
    phoneNumber: '9876543210',
    companyName: 'Test Fleet',
    email: 'rajesh@test.com',
    vehicleNumber: 'TN 47 AB 1234',
    imeiNumber: '123456789012345',
    vehicleType: 'Truck',
    productService: 'GPS Tracker',
    serviceDate: '2026-09-28',
    technician: 'Suresh',
    ratingProductQuality: 5,
    ratingInstallation: 4,
    ratingPerformance: 5,
    ratingProfessionalism: 4,
    ratingSupport: 5,
    issueResolved: 'Yes',
    improvementSuggestions: 'Great service',
    additionalComments: '',
    signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  };

  test('validates correct data', () => {
    const result = feedbackSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  test('rejects missing customer name', () => {
    const result = feedbackSchema.safeParse({ ...validData, customerName: '' });
    expect(result.success).toBe(false);
    expect(result.error.errors[0].path).toContain('customerName');
  });

  test('validates 10-digit Indian mobile number', () => {
    // Valid numbers starting with 6-9
    expect(feedbackSchema.safeParse({ ...validData, phoneNumber: '9876543210' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, phoneNumber: '6123456789' }).success).toBe(true);

    // Invalid numbers
    expect(feedbackSchema.safeParse({ ...validData, phoneNumber: '1234567890' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...validData, phoneNumber: '987654321' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...validData, phoneNumber: '98765432100' }).success).toBe(false);
  });

  test('validates IMEI as exactly 15 digits', () => {
    expect(feedbackSchema.safeParse({ ...validData, imeiNumber: '123456789012345' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, imeiNumber: '000000000000000' }).success).toBe(true); // Leading zeros

    // Invalid
    expect(feedbackSchema.safeParse({ ...validData, imeiNumber: '12345678901234' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...validData, imeiNumber: '1234567890123456' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...validData, imeiNumber: 'abcdefghijklmno' }).success).toBe(false);
  });

  test('vehicle type is required free text (not dropdown)', () => {
    expect(feedbackSchema.safeParse({ ...validData, vehicleType: 'Truck' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, vehicleType: '16 Wheeler' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, vehicleType: 'Custom Type 123' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, vehicleType: '' }).success).toBe(false);
  });

  test('validates email only when provided', () => {
    expect(feedbackSchema.safeParse({ ...validData, email: '' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, email: 'valid@test.com' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, email: 'invalid-email' }).success).toBe(false);
  });

  test('validates ratings between 1 and 5', () => {
    expect(feedbackSchema.safeParse({ ...validData, ratingProductQuality: 0 }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...validData, ratingProductQuality: 6 }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...validData, ratingProductQuality: 3 }).success).toBe(true);
  });

  test('validates issue resolution enum', () => {
    expect(feedbackSchema.safeParse({ ...validData, issueResolved: 'Yes' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, issueResolved: 'Partially' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, issueResolved: 'No' }).success).toBe(true);
    expect(feedbackSchema.safeParse({ ...validData, issueResolved: 'Maybe' }).success).toBe(false);
  });

  test('requires digital signature', () => {
    expect(feedbackSchema.safeParse({ ...validData, signature: '' }).success).toBe(false);
    expect(feedbackSchema.safeParse({ ...validData, signature: 'data:image/png;base64,abc' }).success).toBe(true);
  });

  test('optional fields can be empty', () => {
    const result = feedbackSchema.safeParse({
      ...validData,
      companyName: '',
      email: '',
      vehicleNumber: '',
      improvementSuggestions: '',
      additionalComments: '',
    });
    expect(result.success).toBe(true);
  });
});
