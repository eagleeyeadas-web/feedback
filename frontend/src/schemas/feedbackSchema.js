import { z } from 'zod';

export const feedbackSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required').max(200),
  phoneNumber: z.string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  companyName: z.string().max(200).optional().or(z.literal('')),
  email: z.string().email('Enter a valid email address').optional().or(z.literal('')),
  vehicleNumber: z.string().max(20).optional().or(z.literal('')),
  imeiNumber: z.string()
    .regex(/^\d{15}$/, 'IMEI must be exactly 15 numeric digits'),
  vehicleType: z.string().min(1, 'Vehicle type is required').max(100),
  productService: z.string().min(1, 'Product/Service name is required').max(200),
  serviceDate: z.string().min(1, 'Service date is required'),
  technician: z.string().min(1, 'Technician name is required').max(200),

  ratingProductQuality: z.number().min(1, 'Rating is required').max(5),
  ratingInstallation: z.number().min(1, 'Rating is required').max(5),
  ratingPerformance: z.number().min(1, 'Rating is required').max(5),
  ratingProfessionalism: z.number().min(1, 'Rating is required').max(5),
  ratingSupport: z.number().min(1, 'Rating is required').max(5),

  issueResolved: z.enum(['Yes', 'Partially', 'No'], {
    required_error: 'Please select an option',
  }),

  improvementSuggestions: z.string().max(2000).optional().or(z.literal('')),
  additionalComments: z.string().max(2000).optional().or(z.literal('')),

  signature: z.string().min(1, 'Digital signature is required'),
});
