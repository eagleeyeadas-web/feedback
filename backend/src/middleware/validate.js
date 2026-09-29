import { z } from 'zod';

/**
 * Zod schema for feedback submission validation
 */
export const feedbackSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required').max(200).trim(),
  phoneNumber: z.string()
    .regex(/^[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian mobile number'),
  companyName: z.string().max(200).trim().optional().default(''),
  email: z.string().email('Please enter a valid email address').optional().or(z.literal('')),
  vehicleNumber: z.string().max(20).trim().optional().default(''),
  imeiNumber: z.string()
    .regex(/^\d{15}$/, 'IMEI must be exactly 15 numeric digits'),
  vehicleType: z.string().min(1, 'Vehicle type is required').max(100).trim(),
  productService: z.string().min(1, 'Product/Service name is required').max(200).trim(),
  serviceDate: z.string().min(1, 'Service date is required'),
  technician: z.string().min(1, 'Technician name is required').max(200).trim(),
  
  ratingProductQuality: z.number().int().min(1).max(5),
  ratingInstallation: z.number().int().min(1).max(5),
  ratingPerformance: z.number().int().min(1).max(5),
  ratingProfessionalism: z.number().int().min(1).max(5),
  ratingSupport: z.number().int().min(1).max(5),
  
  issueResolved: z.enum(['Yes', 'Partially', 'No'], {
    required_error: 'Please select an issue resolution status',
  }),
  
  improvementSuggestions: z.string().max(2000).trim().optional().default(''),
  additionalComments: z.string().max(2000).trim().optional().default(''),
  
  signature: z.string().min(1, 'Digital signature is required'),
});

/**
 * Express middleware factory for Zod validation
 */
export function validate(schema) {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.body);
      if (!result.success) {
        const errors = result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        return res.status(400).json({ error: 'Validation failed', errors });
      }
      req.validatedBody = result.data;
      next();
    } catch (error) {
      console.error('Validation error:', error);
      return res.status(400).json({ error: 'Invalid request data' });
    }
  };
}
