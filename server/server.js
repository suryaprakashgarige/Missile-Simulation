const express = require('express');
const cors = require('cors');
const path = require('path');
const simulateRoute = require('./api/simulate.route');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', simulateRoute);

// Serve static client files
app.use(express.static(path.join(__dirname, '../client')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to view the simulation.`);
  });
}

module.exports = app;
