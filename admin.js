const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(process.env.SUPABASE_URL, supabaseKey);

// ── ADMIN LOGIN ───────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const { data: teacher, error } = await supabase
    .from('teachers')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !teacher)
    return res.status(404).json({ error: 'No teacher account found with that email.' });

  const valid = (password === teacher.password);
  if (!valid)
    return res.status(401).json({ error: 'Invalid password.' });

  res.json({
    success: true,
    teacher: {
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      dept: teacher.dept
    }
  });
});

// ── CLASS OVERVIEW ────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  const { dept, sem, year, month } = req.query;

  // Build student query
  let studentQuery = supabase.from('students').select('reg_no, first_name, last_name, dept, sem');
  if (dept && dept !== 'ALL') studentQuery = studentQuery.eq('dept', dept);
  if (sem  && sem  !== 'ALL') studentQuery = studentQuery.eq('sem', sem);
  studentQuery = studentQuery.order('reg_no');

  const { data: students, error: stuErr } = await studentQuery;
  if (stuErr) {
    console.error('Admin overview students error:', stuErr);
    return res.status(500).json({ error: 'Failed to fetch student list.' });
  }

  if (!students || students.length === 0)
    return res.json({ success: true, students: [], workingDays: 0 });

  // Build date range
  const n  = new Date();
  const y  = parseInt(year)  || n.getFullYear();
  const m  = parseInt(month) || (n.getMonth() + 1);
  const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
  const monthEnd   = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;

  // Fetch ALL attendance for all students in this month in one query
  const regNos = students.map(s => s.reg_no);
  const { data: attendance, error: attErr } = await supabase
    .from('attendance')
    .select('reg_no, date, status')
    .in('reg_no', regNos)
    .gte('date', monthStart)
    .lte('date', monthEnd);

  if (attErr) {
    console.error('Admin overview attendance error:', attErr);
    return res.status(500).json({ error: 'Failed to fetch attendance data.' });
  }

  // ── FIX: Calculate working days with proper current month check ──
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrentMonth = (y === n.getFullYear() && m === (n.getMonth() + 1));
  const limit = isCurrentMonth ? n.getDate() : daysInMonth;

  // DEBUG LOG
  console.log('Admin Overview Debug:', {
    queryYear: year, queryMonth: month,
    parsedY: y, parsedM: m,
    serverYear: n.getFullYear(), serverMonth: n.getMonth() + 1, serverDate: n.getDate(),
    isCurrentMonth, limit, daysInMonth
  });

  const workingDays = [];
  for (let d = 1; d <= limit; d++) {
    const ds  = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(ds + 'T00:00:00').getDay();
    if (dow !== 0) workingDays.push(ds);
  }
  const totalWD = workingDays.length;

  // Build per-student attendance map (case-insensitive status)
  const attMap = {};
  for (const rec of attendance) {
    if (!attMap[rec.reg_no]) attMap[rec.reg_no] = new Set();
    if (rec.status && rec.status.toLowerCase() === 'present') attMap[rec.reg_no].add(rec.date);
  }

  const result = students.map(s => {
    const presentDates = attMap[s.reg_no] || new Set();
    const presentCount = workingDays.filter(d => presentDates.has(d)).length;
    const absentCount  = totalWD - presentCount;
    const pct          = totalWD > 0 ? Math.round((presentCount / totalWD) * 100) : 0;
    return {
      regNo:      s.reg_no,
      name:       `${s.first_name} ${s.last_name}`,
      firstName:  s.first_name,
      dept:       s.dept,
      sem:        s.sem,
      present:    presentCount,
      absent:     absentCount,
      percentage: pct,
      status:     pct >= 75 ? 'good' : pct >= 60 ? 'medium' : 'low'
    };
  });

  res.json({ success: true, students: result, workingDays: totalWD, year: y, month: m });
});

// ── STUDENT DETAIL ────────────────────────────────────────────
router.get('/student/:regNo', async (req, res) => {
  const { regNo } = req.params;

  const [stuResult, attResult] = await Promise.all([
    supabase.from('students').select('reg_no, first_name, last_name, dept, sem').eq('reg_no', regNo.toUpperCase()).single(),
    supabase.from('attendance').select('date, time, status').eq('reg_no', regNo.toUpperCase()).order('date', { ascending: false })
  ]);

  if (stuResult.error || !stuResult.data)
    return res.status(404).json({ error: 'Student not found.' });

  res.json({
    success: true,
    student:   stuResult.data,
    records:   attResult.data || []
  });
});

// ── DEPT + SEM LISTS ──────────────────────────────────────────
router.get('/filters', async (req, res) => {
  const { data, error } = await supabase.from('students').select('dept, sem');
  if (error) return res.status(500).json({ error: 'Failed to fetch filter options.' });

  const depts = [...new Set(data.map(s => s.dept).filter(Boolean))].sort();
  const sems  = [...new Set(data.map(s => s.sem).filter(Boolean))].sort();
  res.json({ success: true, depts, sems });
});

// ── CLASS-LEVEL STATS ─────────────────────────────────────────
router.get('/class-stats', async (req, res) => {
  const { dept, sem, year, month } = req.query;
  const n = new Date();
  const y = parseInt(year)  || n.getFullYear();
  const m = parseInt(month) || (n.getMonth() + 1);

  let studentQuery = supabase.from('students').select('reg_no');
  if (dept && dept !== 'ALL') studentQuery = studentQuery.eq('dept', dept);
  if (sem  && sem  !== 'ALL') studentQuery = studentQuery.eq('sem', sem);

  const { data: students, error: stuErr } = await studentQuery;
  if (stuErr) return res.status(500).json({ error: 'Failed to fetch students.' });
  if (!students || !students.length)
    return res.json({ success: true, totalStudents: 0, avgPct: 0, good: 0, medium: 0, low: 0, notStarted: 0 });

  const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
  const monthEnd   = `${y}-${String(m).padStart(2,'0')}-${String(new Date(y, m, 0).getDate()).padStart(2,'0')}`;

  const regNos = students.map(s => s.reg_no);
  const { data: att } = await supabase
    .from('attendance').select('reg_no, date, status')
    .in('reg_no', regNos).gte('date', monthStart).lte('date', monthEnd);

  // ── FIX: Calculate working days with proper current month check ──
  const daysInMonth = new Date(y, m, 0).getDate();
  const isCurrentMonth = (y === n.getFullYear() && m === (n.getMonth() + 1));
  const limit = isCurrentMonth ? n.getDate() : daysInMonth;

  // DEBUG LOG
  console.log('Admin ClassStats Debug:', {
    queryYear: year, queryMonth: month,
    parsedY: y, parsedM: m,
    serverYear: n.getFullYear(), serverMonth: n.getMonth() + 1, serverDate: n.getDate(),
    isCurrentMonth, limit, daysInMonth
  });

  const workingDays = [];
  for (let d = 1; d <= limit; d++) {
    const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (new Date(ds + 'T00:00:00').getDay() !== 0) workingDays.push(ds);
  }
  const totalWD = workingDays.length;

  // Case-insensitive status check
  const attMap = {};
  for (const rec of (att || [])) {
    if (!attMap[rec.reg_no]) attMap[rec.reg_no] = new Set();
    if (rec.status && rec.status.toLowerCase() === 'present') attMap[rec.reg_no].add(rec.date);
  }

  let good = 0, medium = 0, low = 0, notStarted = 0, totalPct = 0;
  for (const s of students) {
    const present = workingDays.filter(d => (attMap[s.reg_no] || new Set()).has(d)).length;
    const pct     = totalWD > 0 ? Math.round((present / totalWD) * 100) : 0;
    totalPct += pct;
    if (present === 0)  notStarted++;
    else if (pct >= 75) good++;
    else if (pct >= 60) medium++;
    else                low++;
  }

  res.json({
    success: true,
    totalStudents: students.length,
    avgPct:        students.length > 0 ? Math.round(totalPct / students.length) : 0,
    good, medium, low, notStarted, workingDays: totalWD
  });
});

module.exports = router;