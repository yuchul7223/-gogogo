// server.js — 컴활2급 메이트 백엔드 (Express + SQLite + JWT)
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { UNITS, QUESTIONS } = require('./questions');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- 인증 미들웨어 ---------------- */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '토큰이 유효하지 않습니다.' });
  }
}
function adminOnly(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
  next();
}

/* ---------------- 공개 데이터 ---------------- */
// 정답(answer)은 숨기고 문제만 공개한다.
app.get('/api/content', (req, res) => {
  const safeQuestions = QUESTIONS.map((q, i) => ({
    index: i, unit: q.unit, q: q.q, options: q.options
  }));
  res.json({ units: UNITS, questions: safeQuestions });
});

/* ---------------- 회원가입 / 로그인 ---------------- */
app.post('/api/signup', (req, res) => {
  const { email, password, name, goal_score, exam_date } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: '이메일, 비밀번호, 이름은 필수입니다.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: '이미 가입된 이메일입니다.' });

  const hash = bcrypt.hashSync(password, 10);
  // 맨 처음 가입하는 사용자를 자동으로 관리자로 지정 (운영 시 변경 권장)
  const isFirstUser = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;

  const info = db.prepare(
    `INSERT INTO users (email, password_hash, name, goal_score, exam_date, is_admin)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(email, hash, name, goal_score || 60, exam_date || null, isFirstUser ? 1 : 0);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = issueToken(user);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }
  const token = issueToken(user);
  res.json({ token, user: publicUser(user) });
});

function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
function publicUser(user) {
  return {
    id: user.id, email: user.email, name: user.name,
    goal_score: user.goal_score, exam_date: user.exam_date, is_admin: !!user.is_admin
  };
}

/* ---------------- 내 프로필 ---------------- */
app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  res.json(publicUser(user));
});

app.put('/api/me', auth, (req, res) => {
  const { name, goal_score, exam_date } = req.body;
  db.prepare('UPDATE users SET name = ?, goal_score = ?, exam_date = ? WHERE id = ?')
    .run(name, goal_score, exam_date || null, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(publicUser(user));
});

/* ---------------- 문제 풀이 제출 (서버가 정답 검증) ---------------- */
app.post('/api/attempt', auth, (req, res) => {
  const { qIndex, choice } = req.body;
  const q = QUESTIONS[qIndex];
  if (!q) return res.status(400).json({ error: '존재하지 않는 문제입니다.' });
  const correct = choice === q.answer;

  db.prepare(
    `INSERT INTO attempts (user_id, unit_id, q_index, correct) VALUES (?, ?, ?, ?)`
  ).run(req.user.id, q.unit, qIndex, correct ? 1 : 0);

  if (correct) {
    db.prepare(`DELETE FROM wrong_notes WHERE user_id = ? AND q_index = ?`)
      .run(req.user.id, qIndex);
  } else {
    db.prepare(
      `INSERT INTO wrong_notes (user_id, q_index, active, updated_at)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, q_index) DO UPDATE SET active = 1, updated_at = datetime('now')`
    ).run(req.user.id, qIndex);
  }

  res.json({ correct, answer: q.answer, explain: q.explain });
});

/* ---------------- 내 오답노트 ---------------- */
app.get('/api/wrong-notes', auth, (req, res) => {
  const rows = db.prepare(
    `SELECT q_index FROM wrong_notes WHERE user_id = ? AND active = 1`
  ).all(req.user.id);
  const items = rows.map(r => {
    const q = QUESTIONS[r.q_index];
    return { index: r.q_index, unit: q.unit, q: q.q, options: q.options };
  });
  res.json(items);
});

/* ---------------- 내 통계 / 대시보드 ---------------- */
app.get('/api/my-stats', auth, (req, res) => {
  const attempts = db.prepare(
    `SELECT unit_id, correct, q_index, created_at FROM attempts WHERE user_id = ? ORDER BY id ASC`
  ).all(req.user.id);

  const total = attempts.length;
  const correctCount = attempts.filter(a => a.correct).length;
  const overallAccuracy = total ? Math.round((correctCount / total) * 100) : 0;

  const recent = attempts.slice(-30);
  const estimatedScore = recent.length
    ? Math.round((recent.filter(a => a.correct).length / recent.length) * 100)
    : null;

  const byUnit = {};
  for (const u of UNITS) byUnit[u.id] = { total: 0, correct: 0 };
  attempts.forEach(a => {
    byUnit[a.unit_id].total++;
    if (a.correct) byUnit[a.unit_id].correct++;
  });
  const unitAccuracy = Object.fromEntries(
    Object.entries(byUnit).map(([id, v]) => [id, v.total ? Math.round((v.correct / v.total) * 100) : null])
  );

  function subjectProgress(subj) {
    const unitIds = UNITS.filter(u => u.subject === subj).map(u => u.id);
    const totalQ = unitIds.reduce((s, id) => s + QUESTIONS.filter(q => q.unit === id).length, 0);
    const attempted = new Set(attempts.filter(a => unitIds.includes(a.unit_id)).map(a => a.q_index)).size;
    return totalQ ? Math.round(Math.min(attempted, totalQ) / totalQ * 100) : 0;
  }

  const wrongCount = db.prepare(
    `SELECT COUNT(*) AS c FROM wrong_notes WHERE user_id = ? AND active = 1`
  ).get(req.user.id).c;

  res.json({
    total, overallAccuracy, estimatedScore, unitAccuracy, wrongCount,
    subjectProgress: { 1: subjectProgress(1), 2: subjectProgress(2) }
  });
});

/* ---------------- 관리자: 전체 사용자 통계 ---------------- */
app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const dau = db.prepare(
    `SELECT COUNT(DISTINCT user_id) AS c FROM attempts WHERE created_at >= ?`
  ).get(since).c;

  const totalAttempts = db.prepare('SELECT COUNT(*) AS c FROM attempts').get().c;
  const totalCorrect = db.prepare('SELECT COUNT(*) AS c FROM attempts WHERE correct = 1').get().c;
  const avgAccuracy = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

  const avgGoal = db.prepare('SELECT AVG(goal_score) AS a FROM users').get().a || 60;

  const unitRows = db.prepare(
    `SELECT unit_id, COUNT(*) AS total, SUM(correct) AS correct FROM attempts GROUP BY unit_id`
  ).all();
  const unitStats = UNITS.map(u => {
    const row = unitRows.find(r => r.unit_id === u.id);
    const total = row ? row.total : 0;
    const correct = row ? row.correct : 0;
    return {
      unit: u.id, title: u.title, subject: u.subject, total,
      accuracy: total ? Math.round((correct / total) * 100) : null
    };
  });

  // 공통 취약 개념 TOP5 (문항 기준 오답률)
  const qRows = db.prepare(
    `SELECT q_index, COUNT(*) AS total, SUM(correct) AS correct FROM attempts GROUP BY q_index`
  ).all();
  const weakQuestions = qRows
    .map(r => {
      const q = QUESTIONS[r.q_index];
      const wrongRate = Math.round(((r.total - r.correct) / r.total) * 100);
      return { q: q.q, unit: q.unit, subject: UNITS.find(u => u.id === q.unit).subject, wrongRate, total: r.total };
    })
    .filter(r => r.total >= 1)
    .sort((a, b) => b.wrongRate - a.wrongRate)
    .slice(0, 5);

  // 최근 8주 주간 정답률 추이
  const weekly = db.prepare(`
    SELECT strftime('%Y-%W', created_at) AS wk,
           COUNT(*) AS total, SUM(correct) AS correct
    FROM attempts
    GROUP BY wk
    ORDER BY wk DESC
    LIMIT 8
  `).all().reverse().map(r => ({
    week: r.wk, accuracy: r.total ? Math.round((r.correct / r.total) * 100) : 0
  }));

  res.json({
    totalUsers, dau, totalAttempts, avgAccuracy,
    avgGoalScore: Math.round(avgGoal),
    unitStats, weakQuestions, weekly
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`컴활2급 메이트 서버 실행 중 → http://localhost:${PORT}`);
});
