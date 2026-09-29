const frontendPayload = {
  customerName: 'Ramesh Kumar',
  phoneNumber: '9876543210',
  companyName: 'Sri Transport',
  email: 'ramesh@gmail.com',
  vehicleNumber: 'TN 37 AB 1234',
  imeiNumber: '123456789012345',
  vehicleType: 'Truck / Lorry',
  productService: 'ADAS Camera',
  serviceDate: '2026-09-28',
  technician: 'Suresh',
  ratingProductQuality: 4,
  ratingInstallation: 5,
  ratingPerformance: 4,
  ratingProfessionalism: 5,
  ratingSupport: 4,
  issueResolved: 'Yes',
  improvementSuggestions: 'Installation could be faster.',
  additionalComments: 'Good product and excellent support.',
  signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
};

async function testApi() {
  console.log('Posting to http://127.0.0.1:3001/api/feedback ...');
  try {
    const res = await fetch('http://127.0.0.1:3001/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(frontendPayload),
    });
    const status = res.status;
    const json = await res.json();
    console.log('HTTP Status:', status);
    console.log('Response JSON:', json);
  } catch (err) {
    console.error('Fetch Error:', err);
  }
}

testApi();
