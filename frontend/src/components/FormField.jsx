import { AlertCircle } from 'lucide-react';

export default function FormField({
  label,
  required,
  error,
  children,
  id,
  hint,
}) {
  return (
    <div className="animate-fade-in">
      <label htmlFor={id} className="form-label">
        {label}
        {required && <span className="required">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-gray-400 mt-1">{hint}</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          <AlertCircle size={12} />
          {error}
        </p>
      )}
    </div>
  );
}
