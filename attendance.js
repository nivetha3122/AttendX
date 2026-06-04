const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

// ── MARK ATTENDANCE ──────────────────────────────────────────
router.post('/mark', async (req, res) => {
  const { regNo, date, time, status } = req.body;

  if (!regNo || !date) {
    return res.status(400).json({ error: 'Register number and date are required.' });
  }

  const { data: existing, error: existingError } = await supabase
    .from('attendance')
    .select('id, date, time, status')
    .eq('reg_no', regNo.toUpperCase())
    .eq('date', date)
    .maybeSingle();

  if (existingError) {
    console.error('Check attendance error:', existingError);
    return res.status(500).json({ error: 'Failed to check attendance status.' });
  }

  if (existing) {
    return res.status(409).json({
      error: 'Attendance already recorded for today.',
      record: existing
    });
  }

  const { data, error } = await supabase
    .from('attendance')
    .insert([{
      reg_no: regNo.toUpperCase(),
      date,
      time: time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      status: status || 'present'
    }])
    .select()
    .single();

  if (error) {
    console.error('Mark attendance error:', error);
    if (error.code === '23503') {
      return res.status(400).json({
        error: 'This register number is not found in the students table. Please register/login with a saved Supabase student first.'
      });
    }
    if (error.code === '42501') {
      return res.status(500).json({
        error: 'Supabase RLS is blocking attendance. Add your service_role key to SUPABASE_SERVICE_ROLE_KEY in .env, then restart the backend.'
      });
    }
    return res.status(500).json({ error: 'Failed to mark attendance.' });
  }

  res.status(201).json({
    success: true,
    message: 'Attendance marked successfully!',
    record: data
  });
});

// ── GET ALL RECORDS FOR A STUDENT ────────────────────────────
router.get('/records/:regNo', async (req, res) => {
  const { regNo } = req.params;

  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('reg_no', regNo.toUpperCase())
    .order('date', { ascending: false });

  if (error) {
    console.error('Get records error:', error);
    return res.status(500).json({ error: 'Failed to fetch records.' });
  }

  const records = data.map(r => ({
    date: r.date,
    time: r.time,
    status: r.status
  }));

  res.json({ success: true, records });
});

// ── GET MONTHLY STATS ────────────────────────────────────────
router.get('/stats/:regNo', async (req, res) => {
  const { regNo } = req.params;
  const { year, month } = req.query;

  const n = new Date();
  const y = parseInt(year) || n.getFullYear();
  const m = parseInt(month) || (n.getMonth() + 1);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('attendance')
    .select('date, status')
    .eq('reg_no', regNo.toUpperCase())
    .gte('date', monthStart)
    .lte('date', monthEnd);

  if (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats.' });
  }

  // Case-insensitive status check
  const presentDates = new Set(data.filter(r => r.status && r.status.toLowerCase() === 'present').map(r => r.date));

  // Calculate working days elapsed
  const workingDays = [];
  const daysInMonth = new Date(y, m, 0).getDate();

  // FIX: Properly determine if querying current month
  const isCurrentMonth = (y === n.getFullYear() && m === (n.getMonth() + 1));
  const limit = isCurrentMonth ? n.getDate() : daysInMonth;

  // DEBUG LOG 1
  console.log('Stats Debug Limit:', { 
    regNo: regNo.toUpperCase(), 
    queryYear: year, queryMonth: month,
    parsedY: y, parsedM: m,
    serverYear: n.getFullYear(), serverMonth: n.getMonth() + 1, serverDate: n.getDate(),
    serverISO: n.toISOString(),
    isCurrentMonth, limit, daysInMonth 
  });

  for (let d = 1; d <= limit; d++) {
    const dd = String(d).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ds = `${y}-${mm}-${dd}`;
    const dow = new Date(`${ds}T00:00:00`).getDay();
    if (dow !== 0) workingDays.push(ds);
  }

  const totalWD = workingDays.length;
  const presentCount = workingDays.filter(d => presentDates.has(d)).length;
  const absentCount = totalWD - presentCount;
  const pct = totalWD > 0 ? Math.round((presentCount / totalWD) * 100) : 0;

  // DEBUG LOG 2
  console.log('Stats Debug Result:', { 
    totalWD, presentCount, absentCount, pct,
    presentDatesArray: [...presentDates], workingDays 
  });

  res.json({
    success: true,
    stats: {
      totalWorkingDays: totalWD,
      present: presentCount,
      absent: absentCount,
      percentage: pct,
      presentDates: [...presentDates]
    }
  });
});

// ── CHECK TODAY'S STATUS ──────────────────────────────────────
router.get('/today/:regNo', async (req, res) => {
  const { regNo } = req.params;
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('attendance')
    .select('date, time, status')
    .eq('reg_no', regNo.toUpperCase())
    .eq('date', today)
    .single();

  if (error || !data) {
    return res.json({ success: true, marked: false, record: null });
  }

  res.json({ success: true, marked: true, record: data });
});

module.exports = router;