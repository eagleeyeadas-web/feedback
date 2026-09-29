import { describe, test, expect } from '@jest/globals';
import { generateFeedbackPDF } from '../src/services/pdfGenerator.js';

describe('PDF Generation', () => {
  const sampleFeedback = {
    feedback_id: 'EE-20260928-0001',
    customer_name: 'Rajesh Kumar',
    phone_number: '9876543210',
    company_name: 'Test Fleet Services',
    email: 'rajesh@test.com',
    vehicle_number: 'TN 47 AB 1234',
    imei_number: '123456789012345',
    vehicle_type: 'Truck',
    product_service: 'GPS Tracker Pro',
    service_date: '2026-09-28',
    technician: 'Suresh Kumar',
    rating_product_quality: 5,
    rating_installation: 4,
    rating_performance: 5,
    rating_professionalism: 4,
    rating_support: 5,
    issue_resolved: 'Yes',
    improvement_suggestions: 'The service was excellent. Would love to see more features in the app.',
    additional_comments: 'Great team and professional installation.',
    submitted_at: '2026-09-28T10:30:00+05:30',
    signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  };

  test('generates a valid PDF buffer', async () => {
    const buffer = await generateFeedbackPDF(sampleFeedback);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test('generated PDF starts with PDF header', async () => {
    const buffer = await generateFeedbackPDF(sampleFeedback);
    const header = buffer.slice(0, 5).toString();
    expect(header).toBe('%PDF-');
  });

  test('generates PDF without optional fields', async () => {
    const minimalFeedback = {
      ...sampleFeedback,
      company_name: null,
      email: null,
      vehicle_number: null,
      improvement_suggestions: null,
      additional_comments: null,
      signatureDataUrl: null,
    };
    const buffer = await generateFeedbackPDF(minimalFeedback);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test('generates PDF with long comments (multi-page)', async () => {
    const longFeedback = {
      ...sampleFeedback,
      improvement_suggestions: 'Lorem ipsum dolor sit amet. '.repeat(100),
      additional_comments: 'Additional detailed comment. '.repeat(100),
    };
    const buffer = await generateFeedbackPDF(longFeedback);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test('includes feedback ID in PDF content', async () => {
    const buffer = await generateFeedbackPDF(sampleFeedback);
    const content = buffer.toString('latin1');
    expect(content).toContain('EE-20260928-0001');
  });

  test('generates PDF with all resolution types', async () => {
    for (const resolution of ['Yes', 'Partially', 'No']) {
      const buffer = await generateFeedbackPDF({ ...sampleFeedback, issue_resolved: resolution });
      expect(buffer).toBeInstanceOf(Buffer);
    }
  });
});
