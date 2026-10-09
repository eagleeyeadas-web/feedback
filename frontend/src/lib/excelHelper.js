/**
 * Utility functions for exporting Installation Checklists to Microsoft Excel (CSV format with UTF-8 BOM)
 */

export function downloadInstallationExcel(item) {
  if (!item) return;

  const headers = [
    'Checklist Number',
    'Created Date',
    'Client Name',
    'Client Mobile Number',
    'Client Location',
    'Google Maps Location',
    'Type of Device',
    'Number of Devices',
    'Number of Vehicles',
    'Extra Devices Carried',
    'Type of Extra Device',
    'Number of Extra Devices',
    'Confirmed Price (INR)',
    'Payment Method',
    'Advance Received',
    'Advance Amount (INR)',
    'Pending Payment',
    'Pending Payment Amount (INR)',
    'Installation Duration',
    'Vehicle Type',
    'Expected Arrival Date',
    'Expected Arrival Time',
    'Installation or Service',
    'Team Member 1 - Service Engineer',
    'Team Member 2 - Service Assistant',
    'Installation Status',
    'Payment Status',
    'Client Confirmation',
    'Remarks',
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const row = [
    item.checklist_number,
    item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN') : '',
    item.client_name,
    item.client_mobile,
    item.client_location || '',
    item.google_maps_location || '',
    item.device_type,
    item.number_of_devices,
    item.number_of_vehicles,
    item.extra_devices ? 'Yes' : 'No',
    item.extra_device_type || '',
    item.extra_device_count || '',
    item.confirmed_price || 0,
    item.payment_method || '',
    item.advance_received ? 'Yes' : 'No',
    item.advance_amount || 0,
    item.pending_payment ? 'Yes' : 'No',
    item.pending_amount || 0,
    item.installation_duration || '',
    item.vehicle_type || '',
    item.expected_arrival_date || '',
    item.expected_arrival_time || '',
    item.installation_or_service || '',
    item.service_engineer || '',
    item.service_assistant || '',
    item.installation_status || '',
    item.payment_status || '',
    item.client_confirmation || '',
    item.remarks || '',
  ];

  const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), row.map(escapeCsv).join(',')].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const filename = `EagleEye-Installation-${item.checklist_number}.csv`;
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadAllInstallationsExcel(items) {
  if (!items || items.length === 0) return;

  const headers = [
    'Checklist Number',
    'Created Date',
    'Client Name',
    'Client Mobile Number',
    'Client Location',
    'Google Maps Location',
    'Type of Device',
    'Number of Devices',
    'Number of Vehicles',
    'Extra Devices Carried',
    'Type of Extra Device',
    'Number of Extra Devices',
    'Confirmed Price (INR)',
    'Payment Method',
    'Advance Received',
    'Advance Amount (INR)',
    'Pending Payment',
    'Pending Payment Amount (INR)',
    'Installation Duration',
    'Vehicle Type',
    'Expected Arrival Date',
    'Expected Arrival Time',
    'Installation or Service',
    'Team Member 1 - Service Engineer',
    'Team Member 2 - Service Assistant',
    'Installation Status',
    'Payment Status',
    'Client Confirmation',
    'Remarks',
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = items.map((item) => [
    item.checklist_number,
    item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN') : '',
    item.client_name,
    item.client_mobile,
    item.client_location || '',
    item.google_maps_location || '',
    item.device_type,
    item.number_of_devices,
    item.number_of_vehicles,
    item.extra_devices ? 'Yes' : 'No',
    item.extra_device_type || '',
    item.extra_device_count || '',
    item.confirmed_price || 0,
    item.payment_method || '',
    item.advance_received ? 'Yes' : 'No',
    item.advance_amount || 0,
    item.pending_payment ? 'Yes' : 'No',
    item.pending_amount || 0,
    item.installation_duration || '',
    item.vehicle_type || '',
    item.expected_arrival_date || '',
    item.expected_arrival_time || '',
    item.installation_or_service || '',
    item.service_engineer || '',
    item.service_assistant || '',
    item.installation_status || '',
    item.payment_status || '',
    item.client_confirmation || '',
    item.remarks || '',
  ]);

  const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const todayStr = new Date().toISOString().split('T')[0];
  const filename = `EagleEye-Installation-Checklists-${todayStr}.csv`;
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
