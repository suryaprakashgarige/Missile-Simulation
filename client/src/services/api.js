const API_URL = '/api';

export async function simulateTrajectory(start, target, config = {}) {
  const response = await fetch(`${API_URL}/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ start, target, ...config })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to fetch trajectory');
  }

  return response.json();
}

