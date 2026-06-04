const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// ── 1. IMPORT ROUTERS (require statements) ──
const authRoutes = require('./auth');
const attendanceRoutes = require('./attendance');
const adminRouter = require('./admin');

// ── 2. CREATE EXPRESS APP ──
const app = express();

// ── 3. MIDDLEWARE ──
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── 4. MOUNT ROUTES ──
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/admin', adminRouter);

// ── 5. ROUTES ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'attendance.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'AttendX API is running' });
});

// ── 6. START SERVER ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AttendX backend running on port ${PORT}`);
});