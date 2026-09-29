async function testHealth() {
  try {
    const res = await fetch('http://127.0.0.1:3001/api/health');
    const data = await res.json();
    console.log('Health check response:', data);
  } catch (err) {
    console.error('Health check failed:', err.message);
  }
}

testHealth();
